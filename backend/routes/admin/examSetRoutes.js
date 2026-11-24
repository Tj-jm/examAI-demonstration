const express = require("express");
const router = express.Router();

const {
  listGroups, getGroup, createGroup, updateGroup, buildSets, setPublished, getResults, deleteGroup,
} = require("../../controllers/admin/examSetController");
const { protect, allow } = require("../../middleware/adminAuth");

// Paper sets: one pool exam cut into several ordinary exams, one per
// student (controllers/admin/examSetController.js). Same access as exams:
// any staff, deleting owner and admin only.
router.use(protect);

router.route("/").get(listGroups).post(createGroup);
router.route("/:id").get(getGroup).put(updateGroup).delete(allow("owner", "admin"), deleteGroup);
router.post("/:id/build", buildSets);
router.put("/:id/publish", setPublished);
router.get("/:id/results", getResults);

module.exports = router;
