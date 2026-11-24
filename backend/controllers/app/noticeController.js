const asyncHandler = require("express-async-handler");
const Notice = require("../../models/noticeModel");
const { shape: shapeMedia } = require("../admin/mediaController");

const shapeNotice = async (notice) => {
  // Lists are queried with .lean(), so this may already be a plain object.
  const doc = typeof notice.toObject === "function" ? notice.toObject() : notice;
  return { ...doc, coverImage: doc.coverImage ? await shapeMedia(doc.coverImage) : null };
};

// A soft cap, not a page size — the homepage carousel has no pagination
// control, it just cycles through whatever comes back. This exists purely
// so an institution that never prunes old general notices can't hand the
// homepage an unbounded list to render at once.
const GENERAL_NOTICE_LIMIT = 20;

//@desc   Every live general notice, for the homepage carousel
//@route  GET /api/app/notices/general
//@access Private (student)
const getGeneralNotices = asyncHandler(async (req, res) => {
  const notices = await Notice.find(Notice.liveQuery({ noticeType: "general" }))
    .populate("coverImage")
    .sort({ createdAt: -1 })
    .limit(GENERAL_NOTICE_LIMIT)
    .lean();

  res.status(200).json({ notices: await Promise.all(notices.map(shapeNotice)) });
});

//@desc   Paginated, live notices for one batch — Notice Central
//@route  GET /api/app/batches/:batchId/notices
//@access Private (student + batchAccess)
const getBatchNotices = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  const query = Notice.liveQuery({ noticeType: "batch", batches: req.batch._id });

  const [notices, total] = await Promise.all([
    Notice.find(query)
      .populate("coverImage")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    // Counted from the exact same query the page is drawn from — a
    // mismatched count is what silently breaks pagination one page before
    // the end, and is the specific bug this rewrite fixes.
    Notice.countDocuments(query),
  ]);

  res.status(200).json({
    notices: await Promise.all(notices.map(shapeNotice)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

module.exports = { getGeneralNotices, getBatchNotices };
