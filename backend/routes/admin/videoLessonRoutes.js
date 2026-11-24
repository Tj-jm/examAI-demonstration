const express = require("express");
const router = express.Router();

const { courseLessons, getLesson, generateLesson, updateLesson, deleteLesson, voiceLesson, stopVoice, reviseSegment, humanizeSegment, segmentAudio, exportLesson, exportPart, exportStatus, exportFile, renderExport, uploadImage, uploadClip, clipFile, aiImage } = require("../../controllers/admin/videoLessonController");
const { protect, allow } = require("../../middleware/adminAuth");
const { aiLimiter } = require("../../middleware/rateLimit");

// AI video lessons for a question's solution or a lecture.
router.use(protect, allow("owner", "admin"));

router.get("/", getLesson);
router.get("/course", courseLessons);
router.post("/generate", aiLimiter, generateLesson);
router.put("/:id", updateLesson);
router.post("/:id/voice", aiLimiter, voiceLesson);
router.post("/:id/voice/stop", stopVoice);
router.post("/:id/stop", stopVoice);
router.post("/:id/revise", aiLimiter, reviseSegment);
router.post("/:id/humanize", aiLimiter, humanizeSegment);
router.get("/:id/audio/:segmentId", segmentAudio);
// The recorded video arrives as the raw request body.
// A long recording comes in parts while it's made, then /export names it.
router.post("/:id/export/part", express.raw({ type: "application/octet-stream", limit: "16mb" }), exportPart);
// Optional: the server plays the lesson and makes the MP4 (no screen recording).
router.post("/:id/render", renderExport);
router.get("/:id/export/status", exportStatus);
router.get("/:id/export/file", exportFile);
router.post("/:id/export", express.raw({ type: ["video/mp4", "video/webm"], limit: "500mb" }), exportLesson);
router.post("/:id/image", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "10mb" }), uploadImage);
router.post("/:id/ai-image", aiLimiter, aiImage);
router.post("/:id/clip", express.raw({ type: ["video/mp4", "video/webm"], limit: "100mb" }), uploadClip);
router.get("/:id/clip/:segmentId/:index", clipFile);
router.delete("/:id", deleteLesson);

module.exports = router;
