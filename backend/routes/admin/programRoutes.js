const express = require("express");
const router = express.Router({ mergeParams: true });

const {
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  reorderPrograms,
} = require("../../controllers/admin/programController");

const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect);

router
  .route("/")
  .get(getPrograms)
  .post(allow("owner", "admin"), createProgram);

// Declared before /:id so "reorder" is not read as an id.
router.put("/reorder", allow("owner", "admin"), reorderPrograms);

router
  .route("/:id")
  .get(getProgram)
  .put(allow("owner", "admin"), updateProgram)
  .delete(allow("owner", "admin"), deleteProgram);

module.exports = router;
