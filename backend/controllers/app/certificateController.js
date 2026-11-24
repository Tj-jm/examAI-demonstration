const asyncHandler = require("express-async-handler");
const Certificate = require("../../models/certificateModel");
const AppSettings = require("../../models/appSettingsModel");
const { normaliseSerial, verifyUrlFor } = require("../../utils/certificates");

//@desc   My certificates
//@route  GET /api/app/certificates
//@access Private (student)
const getMyCertificates = asyncHandler(async (req, res) => {
  const list = await Certificate.find({ student: req.student._id, revokedAt: null })
    .select("serial title batchName grade issuedAt").sort({ issuedAt: -1 }).lean();
  res.json({ certificates: list });
});

//@desc   Check a certificate by its serial: the certificate, or that it was revoked
//@route  GET /api/app/verify/:serial
//@access Public — the serial is the credential, and showing it is the point
const verifyCertificate = asyncHandler(async (req, res) => {
  const serial = normaliseSerial(req.params.serial);
  const cert = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(serial) ? await Certificate.findOne({ serial }).lean() : null;
  if (!cert) { res.status(404); throw new Error("No certificate has this number."); }
  const settings = await AppSettings.get();
  res.json({
    serial: cert.serial,
    verifyUrl: verifyUrlFor(cert.serial, settings),
    valid: !cert.revokedAt,
    revokedAt: cert.revokedAt,
    recipientName: cert.recipientName,
    batchName: cert.batchName,
    title: cert.title,
    body: cert.body,
    grade: cert.grade,
    issuedAt: cert.issuedAt,
    signatures: cert.signatures || [],
    style: cert.style || "classic",
    brand: { name: settings.siteName || "", logo: settings.logo || null },
  });
});

module.exports = { getMyCertificates, verifyCertificate };
