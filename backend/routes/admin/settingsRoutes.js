const express = require("express");
const router = express.Router();

const {
  getSettings, updateSettings, uploadLogo, uploadFavicon, uploadFeatureIcon, updatePaymentGateway, suggestSeoMeta,
  listCourseSeo, updateCourseSeo, getMascotPresets, generateMascot,
} = require("../../controllers/admin/settingsController");
const { getCleanup, runCleanup } = require("../../controllers/admin/cleanupController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(protect);

router.get("/", getSettings);
router.put("/", allow("owner", "admin"), updateSettings);
router.post("/logo", allow("owner", "admin"), uploadImage, uploadLogo);
router.post("/favicon", allow("owner", "admin"), uploadImage, uploadFavicon);
router.post("/feature-icon/:feature", allow("owner", "admin"), uploadImage, uploadFeatureIcon);
router.post("/seo/suggest", allow("owner", "admin"), suggestSeoMeta);
router.get("/mascot/presets", getMascotPresets);
const emailPreview = require("../../controllers/admin/emailPreviewController");
router.post("/email/preview", allow("owner", "admin"), emailPreview.previewEmail);
router.post("/email/test", allow("owner", "admin"), emailPreview.testEmail);
router.post("/mascot/generate", allow("owner", "admin"), generateMascot);
// Each course page's own search and share tags.
router.get("/seo/courses", allow("owner", "admin"), listCourseSeo);
router.put("/seo/courses/:id", allow("owner", "admin"), updateCourseSeo);
// Owner-only, unlike the rest of settings: these fields move real money and
// an admin does not need them to run day-to-day operations.
router.put("/payment/:provider", allow("owner"), updatePaymentGateway);
// Credentials for email, SMS, Zoom, video, storage, LiveKit (owner only).
const connections = require("../../controllers/admin/connectionsController");
router.get("/connections", allow("owner"), connections.getConnections);
router.put("/connections/:service", allow("owner"), connections.saveConnection);
router.post("/connections/:service/test", allow("owner"), connections.testConnection);
// Owner-only too: deleting old records can't be undone.
router.get("/cleanup", allow("owner"), getCleanup);
router.post("/cleanup", allow("owner"), runCleanup);

module.exports = router;
