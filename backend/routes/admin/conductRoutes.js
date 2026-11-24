const express = require("express");
const router = express.Router();

const {
  listStudents, conductCounts, getStudentRecord, updateEvent, actOnStudent, getConductSettings, updateConductSettings,
} = require("../../controllers/admin/conductController");
const { protect, allow } = require("../../middleware/adminAuth");

router.use(protect, allow("owner", "admin"));

router.get("/", listStudents);
router.get("/counts", conductCounts);
router.get("/settings", getConductSettings);
router.put("/settings", updateConductSettings);
router.get("/students/:id", getStudentRecord);
router.post("/students/:id/action", actOnStudent);
router.put("/events/:id", updateEvent);

module.exports = router;
