const express = require("express");
const router = express.Router();

const {
  getNotices, getNotice, createNotice, updateNotice, deleteNotice,
} = require("../../controllers/admin/noticeController");

const { protect } = require("../../middleware/adminAuth");

// No role restriction beyond authentication — same as lectures and
// questions, which any staff member can create and edit. A notice is
// day-to-day content, not sensitive configuration like payment credentials
// or team management, so there is no reason to lock teachers out of posting
// one.

router.use(protect);

router.route("/").get(getNotices).post(createNotice);
router.route("/:id").get(getNotice).put(updateNotice).delete(deleteNotice);

module.exports = router;
