require("dotenv").config();
// Notes what the environment sets before saved credentials are loaded.
const serviceCredentials = require("./utils/serviceCredentials");

const validateEnv = require("./config/validateEnv");
const connectDB = require("./config/db");
const buildApp = require("./app");

validateEnv();
connectDB();
require("mongoose").connection.once("open", () => serviceCredentials.start());

// Only started here, not from app.js — tests require app.js directly via
// supertest and never want a real background timer running during a test
// run.
require("./jobs/examReminders").start();
require("./jobs/examSchedule").start();
require("./jobs/accountDeletion").start();
require("./jobs/liveAttendance").start();
require("./jobs/agents").start();
require("./jobs/progressReports").start();
require("./jobs/campaigns").start();

// AI questions generated for a lecture quiz before "lecture quiz only"
// existed: marked once, so they leave the question bank like new ones do.
// Only ever touches questions never marked either way, so it runs once.
require("mongoose").connection.once("open", () => {
  setTimeout(async () => {
    try {
      const Lecture = require("./models/lectureModel");
      const ids = (await Lecture.find({}).select("_id").lean()).map((l) => String(l._id));
      if (ids.length) {
        await require("./models/questionModel").Question.updateMany(
          { source: "ai", isForPractice: false, lectureQuizOnly: { $exists: false }, "aiMeta.sourceRef": { $in: ids } },
          { $set: { lectureQuizOnly: true } }
        );
      }
    } catch (error) {
      console.error(`Lecture quiz question backfill: ${error.message}`);
    }
  }, 5000).unref();
});

// Course chat: lectures saved before it existed are indexed once, in the
// background, when it is switched on.
require("mongoose").connection.once("open", () => {
  setTimeout(async () => {
    try {
      const config = await require("./models/aiConfigModel").get();
      if (config.features.docChat) await require("./utils/docIndex").indexMissing();
    } catch (error) {
      console.error(`Course chat index backfill: ${error.message}`);
    }
  }, 5000).unref();
});

// Fixed once at start: lecture notes with pictures pasted from "Read pages"
// before their links were permanent (utils/noteImages.js), and AI "Ace this
// lecture" questions saved as batch practice questions (utils/lectureQuiz.js).
require("mongoose").connection.once("open", () => {
  setTimeout(() => {
    require("./utils/noteImages").fixSavedLectures()
      .then((n) => n && console.log(`Lecture pictures: fixed links in ${n} lecture(s).`))
      .catch((error) => console.error(`Lecture pictures: ${error.message}`));
    require("./utils/lectureQuiz").markAiLectureQuestions()
      .catch((error) => console.error(`Lecture quiz questions: ${error.message}`));
  }, 5000).unref();
});

// The sales demo: fresh data every night (demo/index.js).
if (require("./demo").isDemo()) require("./demo").schedule();

// Background jobs (utils/queue.js): with Redis every server takes jobs
// unless WORKER=off; WORKER_ONLY=1 runs a process that only does that.
require("./utils/queue").startWorkers();
// Buffered exam autosave's writer, and the sweeper that closes attempts
// whose time is up (utils/autosave.js).
require("mongoose").connection.once("open", () => require("./utils/autosave").start());
// Protected videos waiting to be converted (utils/protectedVideo.js).
require("mongoose").connection.once("open", () => require("./utils/protectedVideo").start().catch((e) => console.error(`Protected video queue: ${e.message}`)));

if (process.env.WORKER_ONLY === "1") {
  console.log("Worker only: running background jobs, not serving requests.");
} else {
  const app = buildApp();
  const PORT = process.env.PORT || 5000;

  const server = app.listen(PORT, () =>
    console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`)
  );
  // Node ends any request after 5 minutes; a protected video upload of a
  // few gigabytes on a slow line takes longer (middleware/upload.js).
  server.requestTimeout = 60 * 60 * 1000;
}
