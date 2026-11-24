const express = require("express");
const router = express.Router();

const { listSets, createSet, updateSet, deleteSet, draftSet } = require("../../controllers/admin/interviewSetController");
const { protect, allow } = require("../../middleware/adminAuth");

// Interview practice: the interviews students can pick.
router.use(protect);

router.get("/", listSets);
router.post("/", allow("owner", "admin", "teacher"), createSet);
router.post("/draft", allow("owner", "admin", "teacher"), draftSet);
router.put("/:id", allow("owner", "admin", "teacher"), updateSet);
router.delete("/:id", allow("owner", "admin", "teacher"), deleteSet);

module.exports = router;
