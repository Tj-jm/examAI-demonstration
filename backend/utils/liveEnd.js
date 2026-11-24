const liveClassAdapter = require("../adapters/liveClass");

// Ends a live class: the host's End button, or the attendance sweep once an
// in-app room has stood empty (utils/liveAttendance.js). `user` is who
// pays for the class notes, if captions were on; null for the sweep.
const endClass = async (liveClass, { user = null } = {}) => {
  const adapter = liveClassAdapter.get(liveClass.provider);
  if (liveClass.provider === "livekit") {
    // Last look at who's there, then everyone's stretch ends now.
    const attendance = require("./liveAttendance");
    await attendance.sweepClass(liveClass).catch(() => {});
    await attendance.closeAll(liveClass._id);
    await require("./liveRecording").stop(liveClass).catch(() => {});
  }
  const hadCaptions = liveClass.provider === "livekit" && (await require("../models/liveTranscriptModel").exists({ liveClass: liveClass._id }));
  await adapter.endMeeting(liveClass.externalId);

  liveClass.status = "ended";
  liveClass.endedAt = liveClass.endedAt || new Date();
  await liveClass.save();
  // Captions were on: write the notes now, so they're ready before the
  // recording finishes processing and becomes a lecture.
  if (hadCaptions && liveClass.notes?.status !== "ready") {
    require("./liveNotes").write(liveClass._id, { user }).catch(() => {});
  }
  return liveClass;
};

module.exports = { endClass };
