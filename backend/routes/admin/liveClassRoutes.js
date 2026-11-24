const express = require("express");
const router = express.Router();

const {
  getLiveClasses,
  getLiveClass,
  createLiveClass,
  updateLiveClass,
  deleteLiveClass,
  startLiveClass,
  endLiveClass,
  getProviders,
  getHostToken,
  setSpeaker,
  removeParticipant,
  setPermissions,
  muteParticipant,
  muteAll,
  updateRoomSettings,
  getAttendance,
  saveBoard,
  savePadNotes,
  startRecording,
  stopRecording,
  getRecordings,
  decideRecording,
  joinAsTeacher,
  getTaught,
} = require("../../controllers/admin/liveClassController");

const { protect } = require("../../middleware/adminAuth");
const room = require("../../controllers/liveRoomController");
const liveNotes = require("../../controllers/admin/liveNotesController");

router.use(protect);

// Declared before /:id so "start"/"end" on a specific id still resolve
// through the /:id/... routes below, not this one — order matters only
// where a literal segment could collide with an id, which isn't the case
// here, but kept for consistency with lectureRoutes' own comment on this.
router.get("/providers", getProviders);
router.get("/taught", getTaught);
router.post("/:id/join", joinAsTeacher);
router.post("/:id/room-token", getHostToken);
router.put("/:id/room/participants/:identity/speaker", setSpeaker);
router.delete("/:id/room/participants/:identity", removeParticipant);
router.put("/:id/room/participants/:identity/permissions", setPermissions);
router.post("/:id/room/participants/:identity/mute", muteParticipant);
router.post("/:id/room/mute-all", muteAll);
router.put("/:id/room/settings", updateRoomSettings);
router.get("/:id/attendance", getAttendance);
router.post("/:id/boards", saveBoard);
router.post("/:id/pad-notes", savePadNotes);
router.get("/:id/recordings", getRecordings);
router.post("/:id/recordings/start", startRecording);
router.post("/:id/recordings/stop", stopRecording);
router.put("/:id/recordings/:rid", decideRecording);
router.post("/:id/transcript", liveNotes.addTranscript);
router.route("/:id/notes").get(liveNotes.getNotes).put(liveNotes.updateNotes);
router.post("/:id/notes/generate", liveNotes.generateNotes);
router.get("/:id/qa", room.staffListQuestions);
router.put("/:id/qa/:qid", room.staffUpdateQuestion);
router.route("/:id/polls").get(room.staffListPolls).post(room.staffCreatePoll);
router.put("/:id/polls/:pid", room.staffUpdatePoll);
router.put("/:id/start", startLiveClass);
router.put("/:id/end", endLiveClass);

router.route("/").get(getLiveClasses).post(createLiveClass);

router.route("/:id").get(getLiveClass).put(updateLiveClass).delete(deleteLiveClass);

module.exports = router;
