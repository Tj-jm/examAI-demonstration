const express = require("express");
const router = express.Router();
const c = require("../../controllers/admin/slideController");
const { protect, allow } = require("../../middleware/adminAuth");
const { uploadDocument } = require("../../middleware/upload");

// Admin → Batch → Slides (controllers/admin/slideController.js). The
// controller narrows teachers to the batches they teach.
router.use(protect, allow("owner", "admin", "teacher"));
router.post("/file-text", uploadDocument, c.fileText);
router.get("/pictures", c.pictures);
router.route("/").get(c.listDecks).post(c.createDeck);
router.route("/:id").get(c.getDeck).put(c.saveDeck).delete(c.deleteDeck);
router.post("/:id/duplicate", c.duplicateDeck);
router.get("/:id/items", c.items);
router.post("/:id/outline", c.makeOutline);
router.post("/:id/generate", c.generate);
router.post("/:id/rewrite", c.rewrite);
router.get("/:id/pdf", c.pdf);

module.exports = router;
