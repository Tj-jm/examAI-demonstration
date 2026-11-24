const express = require("express");
const router = express.Router({ mergeParams: true });

const { getLiveClasses, getLiveClass, getRoomToken } = require("../../controllers/app/liveClassController");

// Mounted under /api/app/batches/:batchId/live-classes by batchRoutes,
// behind studentProtect + batchAccess + requireFeature("liveClasses")
// already applied there — nothing here needs to repeat those checks.

router.get("/", getLiveClasses);
router.get("/:id", getLiveClass);
router.post("/:id/room-token", getRoomToken);

const room = require("../../controllers/liveRoomController");
router.route("/:id/qa").get(room.studentListQuestions).post(room.studentAsk);
router.post("/:id/qa/:qid/upvote", room.studentUpvote);
router.get("/:id/polls/current", room.studentCurrentPoll);
router.post("/:id/polls/:pid/answer", room.studentAnswerPoll);

module.exports = router;
