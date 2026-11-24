const asyncHandler = require("express-async-handler");
const Student = require("../../models/studentModel");
const campaigns = require("../../utils/campaigns");

//@desc   The student opened a campaign's link (?c=<id>)
//@route  POST /api/app/account/campaign-click { id }
//@access Private (student)
const campaignClick = asyncHandler(async (req, res) => {
  const counted = await campaigns.recordClick(req.body?.id, req.student._id);
  res.status(200).json({ counted });
});

//@desc   My offers-and-announcements choice
//@route  GET /api/app/account/marketing
//@access Private (student)
const getMarketing = asyncHandler(async (req, res) => {
  res.status(200).json({ optOut: Boolean(req.student.marketingOptOut) });
});

//@desc   Turn offers and announcements on or off
//@route  PUT /api/app/account/marketing { optOut }
//@access Private (student)
const setMarketing = asyncHandler(async (req, res) => {
  await Student.updateOne({ _id: req.student._id }, { $set: { marketingOptOut: Boolean(req.body?.optOut) } });
  res.status(200).json({ optOut: Boolean(req.body?.optOut) });
});

const page = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>`
  + `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#111"><h2>${title}</h2><p>${text}</p></body></html>`;

//@desc   An email's unsubscribe link. Signed per student, no login needed.
//@route  GET /api/app/unsubscribe?s=&t=
//@access Public (signed link)
const unsubscribe = asyncHandler(async (req, res) => {
  const { s, t } = req.query;
  res.set("Content-Type", "text/html; charset=utf-8");
  if (!campaigns.checkUnsubscribe(s, t)) {
    return res.status(400).send(page("Link not valid", "This unsubscribe link isn't valid. You can turn off offers and announcements from your account page in the app."));
  }
  await Student.updateOne({ _id: s }, { $set: { marketingOptOut: true } });
  res.status(200).send(page("Unsubscribed", "You won't get offers and announcements any more. Messages about your exams, classes and account still come. You can turn offers back on from your account page in the app."));
});

module.exports = { campaignClick, getMarketing, setMarketing, unsubscribe };
