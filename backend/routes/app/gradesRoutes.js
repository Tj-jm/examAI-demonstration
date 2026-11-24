const express = require("express");
const router = express.Router({ mergeParams: true });
const { getMyGrades } = require("../../controllers/app/gradesController");

router.get("/", getMyGrades);

module.exports = router;
