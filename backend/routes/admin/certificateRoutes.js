const express = require("express");
const router = express.Router();
const { protect, allow } = require("../../middleware/adminAuth");
const c = require("../../controllers/admin/certificateController");
const { uploadImage } = require("../../middleware/upload");

// Mounted at /api/grading/certificates (teacher accounts reach it through
// the role gate). Graders are refused in the controller.
router.use(protect, allow("owner", "admin", "teacher"));

router.post("/signature", uploadImage, c.uploadSignature);
router.route("/template").get(c.getTemplate).put(c.updateTemplate);
router.get("/", c.listCertificates);
router.get("/candidates/:batchId", c.getCandidates);
router.post("/issue", c.issueCertificates);
router.put("/:id/revoke", c.revokeCertificate);
router.put("/:id/restore", c.restoreCertificate);

module.exports = router;
