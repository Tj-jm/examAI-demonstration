const express = require("express");
const router = express.Router({ mergeParams: true });

const { setItemBatches } = require("../../controllers/admin/assignmentController");
const { protect } = require("../../middleware/adminAuth");

router.use(protect);

// Assignment from the item side — the reverse of /api/batches/:id/assigned.
// Same field, same effect, different entry point.
router.put("/:kind/:itemId/batches", setItemBatches);

module.exports = router;
