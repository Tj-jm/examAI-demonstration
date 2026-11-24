const express = require("express");
const router = express.Router();

const { getUpdates, createUpdate, updateUpdate, deleteUpdate } = require("../../controllers/admin/updateController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect, allow("owner", "admin"));

router.route("/").get(getUpdates).post(createUpdate);
router.route("/:id").put(updateUpdate).delete(deleteUpdate);

module.exports = router;
