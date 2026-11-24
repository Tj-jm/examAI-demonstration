const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
require("../../models/programModel"); // populated below
const Certificate = require("../../models/certificateModel");
const AppSettings = require("../../models/appSettingsModel");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const { roster } = require("../../utils/roster");
const { buildGradebook } = require("../../utils/gradebook");
const { makeSerial, render, verifyUrlFor, cleanSignatures } = require("../../utils/certificates");
const { resolveOwnMediaKey } = require("../../utils/mediaUrl");
const storage = require("../../adapters/storage");
const { notify } = require("../../utils/notify");

// Certificates for staff: owners and admins anywhere, teachers on their own
// batches. Graders don't issue certificates.

const refuseGraders = (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders don't issue certificates."); }
};

const assertBatch = async (req, res, batchId) => {
  refuseGraders(req, res);
  if (!mongoose.isValidObjectId(batchId)) { res.status(400); throw new Error("Choose a batch."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((id) => String(id) === String(batchId))) { res.status(403); throw new Error("You are not assigned to this batch."); }
  const batch = await Batch.findById(batchId).select("name program gradebook").populate("program", "name");
  if (!batch) { res.status(404); throw new Error("Batch not found."); }
  return batch;
};

const templateOf = (settings) => {
  const t = settings.certificates || {};
  return {
    title: t.title || "Certificate of Completion",
    body: t.body || "This is to certify that {name} has successfully completed {batch}.",
    signatures: (t.signatures || []).map((s) => ({ name: s.name || "", role: s.role || "", image: s.image || null })),
    style: t.style || "classic",
  };
};

//@desc   The default certificate wording
//@route  GET /api/grading/certificates/template
const getTemplate = asyncHandler(async (req, res) => {
  refuseGraders(req, res);
  const settings = await AppSettings.get();
  res.json({ ...templateOf(settings), brand: { name: settings.siteName || "", logo: settings.logo || null } });
});

const clean = (s, max) => String(s || "").trim().slice(0, max);

//@desc   Change the default certificate wording (owner, admin)
//@route  PUT /api/grading/certificates/template
const updateTemplate = asyncHandler(async (req, res) => {
  if (!["owner", "admin"].includes(req.user.role)) { res.status(403); throw new Error("Only an owner or admin can change the certificate design."); }
  const settings = await AppSettings.get();
  const t = templateOf(settings);
  const b = req.body || {};
  if (b.title !== undefined) t.title = clean(b.title, 80) || t.title;
  if (b.body !== undefined) t.body = clean(b.body, 600);
  if (Array.isArray(b.signatures)) t.signatures = cleanSignatures(b.signatures, resolveOwnMediaKey);
  if (["classic", "modern"].includes(b.style)) t.style = b.style;
  settings.certificates = t;
  settings.markModified("certificates");
  await settings.save();
  // Certificates keep the signatures they were issued with, unless the
  // admin asks for the new ones on those already issued too.
  let updated = 0;
  if (b.applyToIssued && Array.isArray(b.signatures)) {
    ({ modifiedCount: updated } = await Certificate.updateMany({ revokedAt: null }, { $set: { signatures: t.signatures } }));
  }
  res.json({ ...(t.toObject ? t.toObject() : t), updated });
});

//@desc   Store a signature picture (uploaded or drawn): certificates and report cards
//@route  POST /api/grading/certificates/signature
const uploadSignature = asyncHandler(async (req, res) => {
  refuseGraders(req, res);
  if (!req.file) { res.status(400); throw new Error("No picture was received."); }
  if (!/^image\/(png|jpeg|webp)$/.test(req.file.mimetype)) { res.status(415); throw new Error("Use a PNG, JPEG or WebP picture."); }
  const stored = await storage.store("signatures", req.file);
  res.status(201).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

const shape = (c, settings) => ({
  _id: c._id, serial: c.serial, verifyUrl: verifyUrlFor(c.serial, settings), title: c.title, recipientName: c.recipientName, batchName: c.batchName,
  grade: c.grade, issuedAt: c.issuedAt, revokedAt: c.revokedAt, revokedReason: c.revokedReason,
  student: c.student, batch: c.batch,
});

//@desc   Certificates issued for a batch
//@route  GET /api/grading/certificates?batch=
const listCertificates = asyncHandler(async (req, res) => {
  refuseGraders(req, res);
  const query = {};
  if (req.query.batch) { await assertBatch(req, res, req.query.batch); query.batch = req.query.batch; }
  else {
    const ids = await staffBatchIds(req.user);
    if (ids) query.batch = { $in: ids };
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const [list, total] = await Promise.all([
    Certificate.find(query).sort({ issuedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Certificate.countDocuments(query),
  ]);
  const settings = await AppSettings.get();
  res.json({ certificates: list.map((c) => shape(c, settings)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

//@desc   Who can get a certificate in this batch: the register with grades
//@route  GET /api/grading/certificates/candidates/:batchId
const getCandidates = asyncHandler(async (req, res) => {
  const batch = await assertBatch(req, res, req.params.batchId);
  const students = await roster(batch._id);
  const book = await buildGradebook(batch, students);
  const held = await Certificate.find({ batch: batch._id, revokedAt: null }).select("student title").lean();
  res.json({
    batch: { _id: batch._id, name: batch.name, program: batch.program?.name || null },
    students: book.rows.map((r) => ({
      ...r.student, overall: r.overall, letter: r.letter,
      held: held.filter((h) => String(h.student) === String(r.student._id)).map((h) => h.title),
    })),
  });
});

//@desc   Issue certificates to students on the batch's register
//@route  POST /api/grading/certificates/issue
const issueCertificates = asyncHandler(async (req, res) => {
  const { batch: batchId, students: picked, title, body } = req.body || {};
  const batch = await assertBatch(req, res, batchId);
  if (!Array.isArray(picked) || !picked.length) { res.status(400); throw new Error("Choose at least one student."); }
  const settings = await AppSettings.get();
  const t = templateOf(settings);
  const finalTitle = clean(title, 80) || t.title;
  const finalBody = body !== undefined && clean(body, 600) ? clean(body, 600) : t.body;

  const students = await roster(batch._id);
  const wanted = new Set(picked.map(String));
  const chosen = students.filter((s) => wanted.has(String(s._id)));
  if (!chosen.length) { res.status(400); throw new Error("None of those students are on this batch's register."); }
  const book = await buildGradebook(batch, chosen);
  const held = new Set((await Certificate.find({ batch: batch._id, title: finalTitle, revokedAt: null }).select("student").lean()).map((c) => String(c.student)));

  const issued = [];
  let skipped = 0;
  for (const row of book.rows) {
    if (held.has(String(row.student._id))) { skipped += 1; continue; }
    const vars = {
      name: row.student.name, batch: batch.name, program: batch.program?.name || "",
      grade: row.letter || "", date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    };
    let cert = null;
    for (let tries = 0; !cert && tries < 3; tries += 1) {
      try {
        cert = await Certificate.create({
          serial: makeSerial(), student: row.student._id, batch: batch._id, recipientName: row.student.name,
          batchName: batch.name, title: render(finalTitle, vars), body: render(finalBody, vars), grade: row.letter || null,
          signatures: t.signatures, style: t.style, issuedBy: req.user._id,
        });
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    issued.push(cert);
    await notify([row.student._id], "certificateIssued", {
      title: `Certificate: ${cert.title}`,
      body: batch.name,
      link: `/verify/${cert.serial}`,
    }).catch(() => {});
  }
  res.status(201).json({ issued: issued.length, skipped, certificates: issued.map((c) => shape(c, settings)) });
});

const loadCert = async (req, res) => {
  refuseGraders(req, res);
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Certificate not found."); }
  const cert = await Certificate.findById(req.params.id);
  if (!cert) { res.status(404); throw new Error("Certificate not found."); }
  await assertBatch(req, res, cert.batch);
  return cert;
};

//@desc   Revoke a certificate: /verify then shows it as revoked
//@route  PUT /api/grading/certificates/:id/revoke
const revokeCertificate = asyncHandler(async (req, res) => {
  const cert = await loadCert(req, res);
  cert.revokedAt = new Date();
  cert.revokedReason = clean(req.body?.reason, 200);
  await cert.save();
  res.json(shape(cert, await AppSettings.get()));
});

//@desc   Undo a revoke
//@route  PUT /api/grading/certificates/:id/restore
const restoreCertificate = asyncHandler(async (req, res) => {
  const cert = await loadCert(req, res);
  cert.revokedAt = null;
  cert.revokedReason = "";
  await cert.save();
  res.json(shape(cert, await AppSettings.get()));
});

module.exports = { uploadSignature, getTemplate, updateTemplate, listCertificates, getCandidates, issueCertificates, revokeCertificate, restoreCertificate };
