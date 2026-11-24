const express = require("express");
const router = express.Router({ mergeParams: true });
const c = require("../../controllers/app/slideController");

// Mounted under /api/app/batches/:batchId/slides behind studentProtect,
// batchAccess and requireFeature("lectureSlides") (batchRoutes.js).
router.get("/", c.listDecks);
router.get("/:deckId", c.getDeck);
router.get("/:deckId/pdf", c.deckPdf);

module.exports = router;
