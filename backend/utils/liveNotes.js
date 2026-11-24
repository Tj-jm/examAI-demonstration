const LiveClass = require("../models/liveClassModel");
const LiveTranscript = require("../models/liveTranscriptModel");
const prompts = require("../ai/prompts");

// Live captions → transcript → class notes → the lecture made from the
// recording.

// Longer transcripts are written up part by part, then merged.
const PART_CHARS = 24000;

const clean = (s) => String(s || "").replace(/^```[a-z]*\s*|\s*```$/g, "").trim();

// Lines are saved as the host's browser finishes them, a few at a time.
const addLines = async (liveClass, lines, lang) => {
  const docs = (Array.isArray(lines) ? lines : [])
    .slice(0, 200)
    .map((l) => ({ text: String(l?.text || "").trim().slice(0, 2000), at: new Date(l?.at || Date.now()) }))
    .filter((l) => l.text && !Number.isNaN(l.at.getTime()))
    .map((l) => ({ ...l, liveClass: liveClass._id, lang: String(lang || "en-US").slice(0, 12) }));
  if (docs.length) await LiveTranscript.insertMany(docs);
  return docs.length;
};

const transcriptOf = async (liveClassId) => LiveTranscript.find({ liveClass: liveClassId }).sort({ at: 1, _id: 1 }).lean();

const asText = (lines, start) =>
  lines
    .map((l) => {
      const s = Math.max(0, Math.round((new Date(l.at) - start) / 1000));
      return `[${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}] ${l.text}`;
    })
    .join("\n");

// Splits on line boundaries so no sentence is cut in two.
const chunk = (text) => {
  const parts = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length > PART_CHARS) {
      parts.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) parts.push(cur);
  return parts;
};

// Writes the notes. Runs in the background; the page polls notes.status.
const write = async (liveClassId, { user = null } = {}) => {
  const ai = require("../ai/service");
  const liveClass = await LiveClass.findById(liveClassId);
  if (!liveClass) return null;
  const lines = await transcriptOf(liveClass._id);
  if (!lines.length) {
    liveClass.set("notes.status", "failed");
    liveClass.set("notes.error", "No captions were saved for this class.");
    await liveClass.save();
    return liveClass;
  }
  await LiveClass.updateOne({ _id: liveClass._id }, { $set: { "notes.status": "writing", "notes.error": null } });
  try {
    const parts = chunk(asText(lines, new Date(lines[0].at)));
    const written = [];
    for (let i = 0; i < parts.length; i += 1) {
      const r = await ai.complete({
        feature: "live-class-notes",
        ...prompts.liveClassNotes({ title: liveClass.title, transcript: parts[i], part: i + 1, parts: parts.length }),
        maxTokens: 3000,
        user,
        batch: liveClass.batch,
      });
      written.push(clean(r.text));
    }
    let markdown = written[0];
    if (written.length > 1) {
      const r = await ai.complete({
        feature: "live-class-notes",
        ...prompts.mergeLiveClassNotes({ title: liveClass.title, parts: written }),
        maxTokens: 4000,
        user,
        batch: liveClass.batch,
      });
      markdown = clean(r.text);
    }
    await LiveClass.updateOne(
      { _id: liveClass._id },
      { $set: { "notes.markdown": markdown, "notes.status": "ready", "notes.error": null, "notes.generatedAt": new Date(), "notes.editedAt": null } }
    );
    const fresh = await LiveClass.findById(liveClass._id);
    // Lectures already made from the recording get the notes too.
    await applyToLectures(fresh, { untouchedOnly: true }).catch(() => {});
    return fresh;
  } catch (error) {
    await LiveClass.updateOne({ _id: liveClass._id }, { $set: { "notes.status": "failed", "notes.error": error.message } });
    return null;
  }
};

// The lecture body made from a class: its notes, then the saved boards.
const lectureBody = (liveClass) => {
  const notes = liveClass.notes?.status === "ready" && liveClass.notes.markdown?.trim() ? liveClass.notes.markdown.trim() : "";
  const boards = (liveClass.boards || []).map((b, i) => `![Whiteboard ${i + 1}](${b.url})`).join("\n\n");
  return [notes, boards && `## Whiteboards from the class\n\n${boards}`].filter(Boolean).join("\n\n") || undefined;
};

// Puts the current notes into every lecture already made from the class.
// untouchedOnly: skip lectures someone has written in since (their body is
// no longer just the boards the class added).
const applyToLectures = async (liveClass, { untouchedOnly = false } = {}) => {
  const Lecture = require("../models/lectureModel");
  const ids = (liveClass.recordings || []).filter((r) => r.lecture && r.decision !== "deleted").map((r) => r.lecture);
  if (!ids.length) return 0;
  const body = lectureBody(liveClass) || "";
  const filter = { _id: { $in: ids } };
  if (untouchedOnly) {
    const boardsOnly = lectureBody({ boards: liveClass.boards }) || "";
    filter.bodyMarkdown = { $in: boardsOnly ? [boardsOnly] : ["", null] };
  }
  const r = await Lecture.updateMany(filter, { $set: { bodyMarkdown: body } });
  return r.modifiedCount ?? r.nModified ?? 0;
};

module.exports = { addLines, transcriptOf, asText, chunk, write, lectureBody, applyToLectures };
