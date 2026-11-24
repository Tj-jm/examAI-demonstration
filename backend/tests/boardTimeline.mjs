// When things happen in a video lesson (admin-panel and student-app
// components/boardTimeline.js): items at their cue, together, pauses
// holding the board, clips per sentence, and lessons from before cues.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adminFile = path.join(here, "../../admin-panel/src/components/boardTimeline.js");
const studentFile = path.join(here, "../../student-app/src/components/boardTimeline.js");
const { segmentTimeline, sentencesOf, cueIndex } = await import(adminFile);
const { sentencesOf: serverSentences } = (await import("../utils/videoLesson.js")).default;

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};
const near = (a, b) => Math.abs(a - b) < 0.02;

const say = "First we read the question carefully. Then we find the speed of the ball. Finally the answer is ten.";
const parts = [
  { text: "First we read the question carefully.", audioUrl: "a", durationSeconds: 2 },
  { text: "Then we find the speed of the ball.", audioUrl: "b", durationSeconds: 3 },
  { text: "Finally the answer is ten.", audioUrl: "c", durationSeconds: 2 },
];

console.log("board timing");
check("the same file in both apps", fs.readFileSync(adminFile, "utf8") === fs.readFileSync(studentFile, "utf8"));
check("sentences split the same way as the server's voice", JSON.stringify(sentencesOf(say)) === JSON.stringify(serverSentences(say)) && JSON.stringify(sentencesOf("So. It is 3.5 m. Ok then go.")) === JSON.stringify(serverSentences("So. It is 3.5 m. Ok then go.")));
check("a cue is found whatever its case and punctuation", cueIndex(say, "Find the SPEED") === say.indexOf("find the speed") && cueIndex(say, "moon") === -1);

const tl = segmentTimeline({ say, parts, board: [
  { type: "heading", cue: "first we read" },
  { type: "text", cue: "find the speed" },
  { type: "math", with: true },
  { type: "pause", seconds: 1.5, after: "find the speed" },
  { type: "answer", cue: "Finally the answer" },
] });
check("an item appears as the voice says its cue", near(tl.times[0], 0) && near(tl.times[1], 2 + 3 * (8 / 35)), tl.times);
check("\"with the item above\" appears at the same moment", tl.times[2] === tl.times[1]);
check("a pause after a sentence holds the board between its clips", tl.clips.map((c) => c.kind).join() === "audio,audio,pause,audio" && near(tl.clips[2].start, 5) && near(tl.clips[2].dur, 1.5), tl.clips);
check("…and what comes after it waits for it", near(tl.times[4], 6.5) && near(tl.duration, 8.5), { t: tl.times[4], d: tl.duration });

const before = segmentTimeline({ say, audioUrl: "x", durationSeconds: 9, board: [{ type: "pause", seconds: 2, after: "^" }, { type: "heading", cue: "first we read" }] });
check("a pause before the narration delays the voice and the board", before.clips[0].kind === "pause" && near(before.clips[1].start, 2) && near(before.times[1], 2), before);
const legacy = segmentTimeline({ say, audioUrl: "x", durationSeconds: 9, board: [{ type: "text" }, { type: "text" }, { type: "text" }] });
check("a lesson from before cues spreads its items as it always did", JSON.stringify(legacy.times) === "[0,3,6]" && legacy.clips.length === 1, legacy.times);
const silent = segmentTimeline({ say, board: [{ type: "text", cue: "answer is ten" }] });
check("no voice yet: timed from the words, a clip per sentence", silent.clips.length === 3 && silent.clips.every((c) => c.kind === "silent") && silent.times[0] > silent.clips[2].start, silent);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
