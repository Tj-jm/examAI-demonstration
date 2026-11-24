const express = require("express");
const router = express.Router();
const { otpLimiter, webinarLimiter } = require("../../middleware/rateLimit");
const { getWebinar, joinWebinar, verifyWebinar, googleJoin, guestProtect, guestRoomToken, guestReplay } = require("../../controllers/app/webinarController");
const room = require("../../controllers/liveRoomController");

// Public webinars (/w/<slug> in the student app). The page and joining are
// open to anyone; the room, questions and polls need the guest's pass.

router.get("/:slug", getWebinar);
router.post("/:slug/join", webinarLimiter, joinWebinar);
router.post("/:slug/verify", otpLimiter, verifyWebinar);
router.post("/:slug/google", webinarLimiter, googleJoin);
router.post("/:slug/room-token", guestProtect, guestRoomToken);
router.get("/:slug/replay", guestProtect, guestReplay);
router.route("/:slug/qa").get(guestProtect, room.studentListQuestions).post(guestProtect, room.studentAsk);
router.post("/:slug/qa/:qid/upvote", guestProtect, room.studentUpvote);
router.get("/:slug/polls/current", guestProtect, room.studentCurrentPoll);
router.post("/:slug/polls/:pid/answer", guestProtect, room.studentAnswerPoll);

module.exports = router;
