const mongoose = require("mongoose");

// An AI-made video lesson: narration in segments, each with the board
// steps shown while it plays (utils/videoLesson.js, the student and admin
// board players). Either a question's solution video or a lecture's video.
// The steps and per-segment voice are what's kept; an MP4 recorded from
// the player is optional and goes in the usual video slot (the question's
// solutionVideo, the lecture's video).
const boardItemSchema = new mongoose.Schema(
  {
    // heading: a title line. text: a sentence (may hold $...$ maths).
    // math: one display equation (LaTeX, no delimiters). list: bullet
    // points. answer: the boxed result. image: the question's own figure.
    // newBoard: clears the board before what follows.
    // table: rows of cells (first row the header). highlight: marks an
    // earlier item again (ref "segment-item", as the player keys them).
    // pause: the board holds for `seconds` with no voice. diagram: an SVG
    // drawn by AI from `prompt`. clip: a short video played on the board
    // while the voice waits (placed like a pause), or under the voice.
    // sequence: pictures shown one after another in one place (a
    // flipbook). remove: takes an earlier item (ref) off the board or
    // crosses it out. code: program code (text, in `lang`), shown as
    // written. output: what a program prints, as a console. camera: zooms
    // the board onto an earlier item (ref),
    // or back out (no ref).
    type: { type: String, enum: ["heading", "text", "math", "list", "answer", "image", "table", "highlight", "callout", "newBoard", "pause", "diagram", "clip", "sequence", "remove", "camera", "code", "output", "graph", "numberline"], required: true },
    fns: { type: [{ _id: false, expr: String, label: String }], default: undefined },
    xRange: { type: [Number], default: undefined },
    yRange: { type: [Number], default: undefined },
    points: { type: [{ _id: false, x: Number, y: Number, label: String, open: Boolean }], default: undefined },
    spans: { type: [{ _id: false, a: Number, b: Number }], default: undefined },
    check: { type: Boolean, default: undefined },
    from: { type: String, default: undefined },
    // clip (the voice waits): lines spoken at set seconds into the clip,
    // each with its own voice file (forText: the text it was made for).
    lines: {
      type: [{ _id: false, at: Number, text: String, key: String, driver: String, durationSeconds: Number, forText: String }],
      default: undefined,
    },
    // code: its language, for colours (null: plain).
    lang: { type: String, default: null },
    // How it comes on (null: the usual fade up). Optional, for any shown item.
    enter: { type: String, enum: ["fade", "slide", "pop", "zoom", "wipe", "write", "draw", "type", "morph", null], default: null },
    // highlight: how the earlier item is marked again (null: glow).
    emphasis: { type: String, enum: ["glow", "pulse", "underline", "circle", "arrow", "spotlight", "point", null], default: null },
    // remove: how it goes (null: fade away).
    exit: { type: String, enum: ["fade", "strike", "cross", null], default: null },
    // camera: how close (1 to 3; 1 is the whole board); its `seconds` is
    // how long the move takes.
    zoom: { type: Number, default: null },
    // camera: only this part of the item (x, y, w, h in % of its box as it
    // shows on the board), else the whole item.
    area: { type: new mongoose.Schema({ x: Number, y: Number, w: Number, h: Number }, { _id: false }), default: undefined },
    // Beside the item above (in one row) instead of below it.
    row: { type: Boolean, default: undefined },
    // Stays on the board through a new board, until a remove step.
    keep: { type: Boolean, default: undefined },
    // image: only this part of the picture (x, y, w, h in % of it), and a
    // slow zoom or pan while it is on the board.
    crop: { type: new mongoose.Schema({ x: Number, y: Number, w: Number, h: Number }, { _id: false }), default: undefined },
    motion: { type: String, enum: ["in", "out", "left", "right", null], default: null },
    // clip: "pause" (the voice waits, as before) or "over" (the voice goes
    // on over it, from its cue); duck: its own sound under the voice (0 to
    // 1); freeze: seconds its last frame holds after it ends.
    voice: { type: String, enum: ["pause", "over", null], default: null },
    duck: { type: Number, default: null },
    freeze: { type: Number, default: null },
    // sequence: the pictures in order, each from its cue (else `seconds`
    // after the one before); loop: round again while it is on the board.
    frames: {
      type: [{ _id: false, media: { key: String, driver: String }, cue: String, caption: String }],
      default: undefined,
    },
    loop: { type: Boolean, default: null },
    transition: { type: String, enum: ["cut", "fade", null], default: null },
    // diagram: drawn step by step (its SVG groups data-step="1", "2"…),
    // each step at its cue, else `seconds` (1.5) after the one before.
    build: { type: Boolean, default: null },
    stepCues: { type: [String], default: undefined },
    // When it appears: as the voice says these words of the segment's
    // narration. Empty: spread between its neighbours, as before cues.
    cue: { type: String, default: "" },
    // Appears together with the item before it.
    with: { type: Boolean, default: false },
    // pause: how long, and where: "^" before the narration, "" after it,
    // else words of the sentence it follows.
    seconds: { type: Number, default: null },
    after: { type: String, default: "" },
    // clip: where in the video it starts (seconds), its length is `seconds`,
    // and whether its own sound plays. The file is `media`.
    start: { type: Number, default: null },
    sound: { type: Boolean, default: null },
    // diagram: what to draw, and the drawing (sanitised SVG).
    prompt: { type: String, default: "" },
    svg: { type: String, default: "" },
    // callout: a thought bubble ("think") or a labelled note.
    kind: { type: String, enum: ["think", "idea", "tip", "warning", "note", "question", null], default: null },
    text: { type: String, default: "" },
    latex: { type: String, default: "" },
    items: { type: [String], default: undefined },
    // image: the question's figure, the solution's picture or an upload
    // (a picture the AI picked from the library is kept as an upload),
    // with an optional caption and marks drawn over it (x/y in % of the
    // picture).
    src: { type: String, enum: ["question", "solution", "upload", null], default: null },
    media: { key: { type: String, default: null }, driver: { type: String, default: null } },
    caption: { type: String, default: "" },
    size: { type: String, enum: ["small", "medium", "large", "full", null], default: null },
    marks: {
      // old: carried over from the picture's earlier step (shown, not drawn again).
      // color: this mark's own colour (#rrggbb); empty: the video's mark colour.
      type: [{ _id: false, kind: String, x: Number, y: Number, x2: Number, y2: Number, text: String, old: Boolean, color: String }],
      default: undefined,
    },
    // A full-board picture shown whole (letterboxed) with its marks, as in
    // a picture video; null: it fills the board (cropped).
    fit: { type: String, enum: ["contain", null], default: null },
    // Rows as { cells } (not nested arrays, which some Mongo-compatible
    // databases can't store); the API sends them as arrays of cells.
    rows: { type: [{ _id: false, cells: [String] }], default: undefined },
    ref: { type: String, default: null },
    // Where the item sits across the board; null = left.
    align: { type: String, enum: ["left", "center", "right", null], default: null },
  },
  { _id: false }
);

const segmentSchema = new mongoose.Schema(
  {
    // What the voice says, written to be spoken.
    say: { type: String, required: true },
    board: { type: [boardItemSchema], default: [] },
    // This part's board: a preset (whiteboard, blackboard, greenboard,
    // dark) or a colour (#rrggbb); null: the lesson's. layout: stack (as
    // before), center (a title card) or split (pictures on the right).
    background: { type: String, default: null },
    layout: { type: String, enum: ["stack", "center", "split", null], default: null },
    // Spoken audio, one clip per sentence (utils/videoLesson.js
    // sentencesOf): items then appear at their cue to the sentence.
    parts: {
      type: [{ _id: false, text: String, key: String, driver: String, durationSeconds: Number, marks: { type: [Number], default: undefined } }],
      default: undefined,
    },
    // Spoken audio for the whole segment, from before parts (kept so
    // older lessons still play; a new voice replaces it with parts).
    audio: {
      key: { type: String, default: null },
      driver: { type: String, default: null },
      durationSeconds: { type: Number, default: null },
      // The narration it was made from; edited text means new audio.
      forText: { type: String, default: null },
    },
  },
  { _id: true }
);

const videoLessonSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["solution", "lecture", "student"], required: true },
    // kind "student": a short video one student asked for (utils/studentVideo.js),
    // seen only by them. question/lecture stay null (those are one-per-item);
    // what it was made from is in source.
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
    source: {
      lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
      question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
      // The part of the lesson's video they were watching, if any.
      segment: { type: Number, default: null },
      // The passage of the lecture they highlighted, if made from one.
      highlight: { type: String, default: "" },
    },
    ask: { type: String, default: "" },
    // The request wasn't about the lesson: a one-line "only this lesson" video.
    refused: { type: Boolean, default: false },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
    title: { type: String, default: "" },
    language: { type: String, default: "" },
    // Students see it only once it's published.
    published: { type: Boolean, default: false },
    segments: { type: [segmentSchema], default: [] },
    // This video's own board look, over the site's (Settings → video board):
    // a preset, or custom colours. Empty: the site's.
    look: {
      preset: { type: String, default: null },
      board: { type: String, default: null },
      ink: { type: String, default: null },
      accent: { type: String, default: null },
    },
    // The voice the audio was made with.
    voice: {
      provider: { type: String, default: null },
      voice: { type: String, default: null },
    },
    // The MP4 recorded from the player, when there is one.
    exportMedia: { type: mongoose.Schema.Types.ObjectId, ref: "Media", default: null },
    exportedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    generatedAt: { type: Date, default: null },
    // Writing the script or making the voice runs in the background; this
    // is its state, for the editor's progress bar. done/total count voiced
    // segments; expectSeconds is a rough length for a script.
    job: {
      kind: { type: String, enum: ["script", "voice", null], default: null },
      status: { type: String, enum: ["running", "done", "failed", null], default: null },
      startedAt: { type: Date, default: null },
      expectSeconds: { type: Number, default: null },
      done: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      error: { type: String, default: null },
    },
  },
  { timestamps: true }
);

videoLessonSchema.index({ question: 1 }, { unique: true, partialFilterExpression: { question: { $type: "objectId" } } });
videoLessonSchema.index({ lecture: 1 }, { unique: true, partialFilterExpression: { lecture: { $type: "objectId" } } });

videoLessonSchema.index({ student: 1, createdAt: -1 }, { partialFilterExpression: { student: { $type: "objectId" } } });

module.exports = mongoose.model("VideoLesson", videoLessonSchema);
