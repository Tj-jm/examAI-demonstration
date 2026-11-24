const express = require("express");
const router = express.Router();

const { getGeneralNotices } = require("../../controllers/app/noticeController");
const { studentProtect } = require("../../middleware/studentAuth");

// Batch-scoped notices live under /batches/:batchId/notices instead (see
// batchRoutes.js) — general notices reach every student regardless of
// batch, so this is the one student-facing notice route not nested under a
// batch at all.

router.use(studentProtect);
router.get("/general", getGeneralNotices);

module.exports = router;
