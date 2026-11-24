const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  getTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  getAuthorities,
  getArchiveStats,
  createAuthority,
  updateAuthority,
  uploadAuthorityIcon,
  deleteAuthority,
  getTree,
} = require("../../controllers/admin/taxonomyController");

const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(protect);

// Teachers author content, so they may create and edit chapters and topics.
// Subjects define the shape of the install and stay with admins.
router.get("/tree", getTree);

router
  .route("/subjects")
  .get(getSubjects)
  .post(allow("owner", "admin"), createSubject);

router
  .route("/subjects/:id")
  .put(allow("owner", "admin"), updateSubject)
  .delete(allow("owner", "admin"), deleteSubject);

router
  .route("/chapters")
  .get(getChapters)
  .post(createChapter);

router
  .route("/chapters/:id")
  .put(updateChapter)
  .delete(deleteChapter);

router
  .route("/topics")
  .get(getTopics)
  .post(createTopic);

router
  .route("/topics/:id")
  .put(updateTopic)
  .delete(deleteTopic);

// Authorities (boards, entrance exams, textbooks) define the archive's own
// taxonomy — same "admins own it" reasoning as subjects.
router.get("/authorities/archive-stats", getArchiveStats);

router
  .route("/authorities")
  .get(getAuthorities)
  .post(allow("owner", "admin"), createAuthority);

router
  .route("/authorities/:id")
  .put(allow("owner", "admin"), updateAuthority)
  .delete(allow("owner", "admin"), deleteAuthority);

router.post("/authorities/:id/icon", allow("owner", "admin"), uploadImage, uploadAuthorityIcon);

module.exports = router;
