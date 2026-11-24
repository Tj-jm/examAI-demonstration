const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getBatches,
  getBatch,
  createBatch,
  duplicateBatch,
  reorderBatches,
  updateBatch,
  deleteBatch,
  addPlan,
  updatePlan,
  deletePlan,
  uploadBatchIcon,
  getContentCoverage,
} = require("../../controllers/admin/batchController");

const {
  getAssigned,
  getAssignable,
  assignToBatch,
  assignMatching,
  unassignFromBatch,
  copyAssignments,
} = require("../../controllers/admin/assignmentController");

const { getOutline, saveOutline } = require("../../controllers/admin/outlineController");

const { protect, allow } = require("../../middleware/adminAuth");
const { requireBatchTeacher } = require("../../middleware/batchTeacherAuth");
const { uploadImage } = require("../../middleware/upload");
const {
  getCreditPlans, createCreditPlan, updateCreditPlan, deleteCreditPlan,
} = require("../../controllers/admin/aiCreditController");

router.use(protect);

router
  .route("/")
  .get(getBatches)
  .post(allow("owner", "admin"), createBatch);

// Declared before /:id so "reorder" is not read as an id.
router.put("/reorder", allow("owner", "admin"), reorderBatches);

router
  .route("/:id")
  .get(requireBatchTeacher, getBatch)
  .put(allow("owner", "admin"), updateBatch)
  .delete(allow("owner", "admin"), deleteBatch);

router.post("/:id/duplicate", allow("owner", "admin"), duplicateBatch);
const { promotePreview, promote } = require("../../controllers/admin/promoteController");
router.get("/:id/promote", allow("owner", "admin"), promotePreview);
router.post("/:id/promote", allow("owner", "admin"), promote);

// Pricing is an admin concern, not a teaching one.
router.post("/:id/plans", allow("owner", "admin"), addPlan);
router.put("/:id/plans/:planId", allow("owner", "admin"), updatePlan);
router.delete("/:id/plans/:planId", allow("owner", "admin"), deletePlan);

// AI credit packs — same access level as pricing, same reasoning: what a
// student can buy is an admin decision, not a teaching one.
router
  .route("/:id/ai-credit-plans")
  .get(allow("owner", "admin"), getCreditPlans)
  .post(allow("owner", "admin"), createCreditPlan);
router
  .route("/:id/ai-credit-plans/:planId")
  .put(allow("owner", "admin"), updateCreditPlan)
  .delete(allow("owner", "admin"), deleteCreditPlan);

router.post("/:id/icon", allow("owner", "admin"), uploadImage, uploadBatchIcon);

// Assignment from the batch side. Teachers do this as part of authoring —
// but only for a batch they're actually assigned to teach.
router.get("/:id/assignable/:kind", requireBatchTeacher, getAssignable);
router
  .route("/:id/assigned/:kind")
  .get(requireBatchTeacher, getAssigned)
  .post(requireBatchTeacher, assignToBatch)
  .delete(requireBatchTeacher, unassignFromBatch);

router.post("/:id/assign-matching/:kind", requireBatchTeacher, assignMatching);
router.post("/:id/copy-from/:sourceId", requireBatchTeacher, copyAssignments);

// Which chapter-pools and topics actually have a question in this batch —
// same visibility level as the batch itself (owner/admin, or a teacher
// assigned to it).
router.get("/:id/content-coverage", requireBatchTeacher, getContentCoverage);

// The batch's own order and named groups for everything it teaches.
router
  .route("/:id/outline")
  .get(requireBatchTeacher, getOutline)
  .put(requireBatchTeacher, saveOutline);

module.exports = router;
