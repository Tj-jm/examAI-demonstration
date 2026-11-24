const express = require("express");
const router = express.Router();
const { studentProtect } = require("../../middleware/studentAuth");
const { getMyCertificates, verifyCertificate } = require("../../controllers/app/certificateController");

router.get("/certificates", studentProtect, getMyCertificates);
// Public: anyone holding the certificate's number can check it.
router.get("/verify/:serial", verifyCertificate);

module.exports = router;
