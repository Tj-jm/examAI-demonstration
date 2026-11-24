const express = require("express");
const router = express.Router();

const { getPublicLandingPage } = require("../../controllers/app/publicController");

router.get("/", getPublicLandingPage);

module.exports = router;
