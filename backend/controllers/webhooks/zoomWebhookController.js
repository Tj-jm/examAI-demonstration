const asyncHandler = require("express-async-handler");
const LiveClass = require("../../models/liveClassModel");
const liveClassAdapter = require("../../adapters/liveClass");

// This route is public by necessity — Zoom calls it directly, with no
// session of any kind. Trust comes entirely from the signature check in
// verifyWebhookSignature(), the same reasoning as the payment gateway
// webhook at /api/app/purchases/webhook/:provider. See tests/routeAudit.js's
// PUBLIC allowlist for the matching entry.
//
// Mounted with express.raw() ahead of express.json() in app.js — req.body
// arrives here as a Buffer of the exact bytes Zoom sent, which the
// signature check needs untouched.
const zoomWebhook = asyncHandler(async (req, res) => {
  const rawBody = req.body.toString("utf8");
  const payload = JSON.parse(rawBody);
  const zoom = liveClassAdapter.get("zoom");

  // The one-time handshake Zoom does when the endpoint URL is first saved
  // in the Zoom app config — no signature to check, the correct
  // encryptedToken response is the proof.
  if (zoom.isWebhookValidationRequest(payload)) {
    try {
      return res.status(200).json(zoom.answerWebhookValidation(payload));
    } catch (error) {
      res.status(400);
      throw new Error(error.message);
    }
  }

  try {
    zoom.verifyWebhookSignature(rawBody, req.headers);
  } catch (error) {
    res.status(401);
    throw new Error(error.message);
  }

  const event = zoom.parseWebhookEvent(payload);

  // Acknowledged rather than erroring: an event type this platform
  // doesn't act on, or one for a meeting Zoom knows about that was never
  // scheduled through here (e.g. an ad-hoc meeting on the same account),
  // is not a failure — Zoom would just retry forever otherwise.
  if (event.type === "ignored" || !event.meetingId) {
    return res.status(200).json({ received: true, ignored: true });
  }

  const liveClass = await LiveClass.findOne({ externalId: event.meetingId, provider: "zoom" });
  if (!liveClass) {
    return res.status(200).json({ received: true, ignored: true, reason: "unknown meeting" });
  }

  switch (event.type) {
    case "meeting.started":
      // Covers the host starting the meeting from their own Zoom client
      // (or phone) instead of this platform's Start button — the status
      // shown to students should reflect what's actually happening on
      // Zoom, not just what was clicked here.
      liveClass.status = "live";
      liveClass.liveSince = liveClass.liveSince || new Date();
      break;

    case "meeting.ended":
      liveClass.status = "ended";
      liveClass.endedAt = liveClass.endedAt || new Date();
      break;

    case "participant.joined":
      liveClass.attendance.push(event.participant);
      break;

    case "participant.left": {
      // Matched by Zoom's own per-session participant id, newest
      // still-open record first — the same participant can join and
      // leave more than once in one session (a dropped connection,
      // reconnecting), and each span should close independently rather
      // than the first join eating every later leave event.
      const record = [...liveClass.attendance]
        .reverse()
        .find((a) => a.externalParticipantId === event.participant.externalParticipantId && !a.leftAt);
      if (record) record.leftAt = event.participant.leftAt;
      break;
    }
  }

  await liveClass.save();
  res.status(200).json({ received: true });
});

module.exports = { zoomWebhook };
