const asyncHandler = require("express-async-handler");
const LiveClass = require("../../models/liveClassModel");
const notes = require("../../utils/liveNotes");
const { loadRoom } = require("./liveClassController");

// Captions saved from the host's browser, and the class notes made from them.

const view = async (liveClass) => {
  const lines = await notes.transcriptOf(liveClass._id);
  return {
    title: liveClass.title,
    status: liveClass.status,
    notes: liveClass.notes || { markdown: "", status: "none" },
    lectures: (liveClass.recordings || []).filter((r) => r.lecture && r.decision !== "deleted").map((r) => r.lecture),
    transcript: lines.map((l) => ({ text: l.text, at: l.at })),
  };
};

//@desc   Save finished caption lines (from the host's browser)
//@route  POST /api/live-classes/:id/transcript  { lines: [{ text, at }], lang }
//@access Private
const addTranscript = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (liveClass.status !== "live") {
    res.status(409);
    throw new Error("The class isn't live.");
  }
  res.status(200).json({ saved: await notes.addLines(liveClass, req.body.lines, req.body.lang) });
});

//@desc   The transcript and notes. ?format=txt downloads the transcript.
//@route  GET /api/live-classes/:id/notes
//@access Private
const getNotes = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (req.query.format === "txt") {
    const lines = await notes.transcriptOf(liveClass._id);
    const text = lines.length ? notes.asText(lines, new Date(lines[0].at)) : "";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="transcript-${liveClass._id}.txt"`);
    return res.status(200).send(text);
  }
  res.status(200).json(await view(liveClass));
});

//@desc   Write (or rewrite) the notes with AI, in the background
//@route  POST /api/live-classes/:id/notes/generate
//@access Private
const generateNotes = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (liveClass.notes?.status === "writing") {
    res.status(409);
    throw new Error("The notes are already being written.");
  }
  const LiveTranscript = require("../../models/liveTranscriptModel");
  if (!(await LiveTranscript.exists({ liveClass: liveClass._id }))) {
    res.status(400);
    throw new Error("No captions were saved for this class. Turn on captions in the classroom to get notes.");
  }
  await LiveClass.updateOne({ _id: liveClass._id }, { $set: { "notes.status": "writing", "notes.error": null } });
  notes.write(liveClass._id, { user: req.user._id }).catch(() => {});
  res.status(202).json(await view(await LiveClass.findById(liveClass._id)));
});

//@desc   Save edited notes; optionally put them into the class's lectures
//@route  PUT /api/live-classes/:id/notes  { markdown, applyToLectures }
//@access Private
const updateNotes = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (typeof req.body.markdown === "string") {
    liveClass.set("notes.markdown", req.body.markdown.slice(0, 100000));
    liveClass.set("notes.status", req.body.markdown.trim() ? "ready" : "none");
    liveClass.set("notes.error", null);
    liveClass.set("notes.editedAt", new Date());
    await liveClass.save();
  }
  const applied = req.body.applyToLectures ? await notes.applyToLectures(liveClass) : 0;
  res.status(200).json({ ...(await view(liveClass)), applied });
});

module.exports = { addTranscript, getNotes, generateNotes, updateNotes };
