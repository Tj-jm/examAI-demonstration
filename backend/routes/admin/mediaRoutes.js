const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  upload,
  linkVideo,
  fromDocument,
  getMedia,
  deleteMedia,
  getProviders,
  uploadProtected,
  protectMedia,
  protectedSummary,
  protectAll,
} = require("../../controllers/admin/mediaController");

const { protect } = require("../../middleware/adminAuth");
const { uploadImage, uploadProtectedVideo } = require("../../middleware/upload");

router.use(protect);

// Declared before /:id so "providers" is not read as an id.
router.get("/providers", getProviders);
router.get("/protected/summary", protectedSummary);
router.post("/protected/all", protectAll);
router.post("/protected", uploadProtectedVideo, uploadProtected);
router.post("/:id/protect", protectMedia);

router.post("/upload", uploadImage, upload);
router.post("/video", linkVideo);
router.post("/from-document/:documentId", fromDocument);

router
  .route("/:id")
  .get(getMedia)
  .delete(deleteMedia);

module.exports = router;