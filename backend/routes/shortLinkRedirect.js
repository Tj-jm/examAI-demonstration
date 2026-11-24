const express = require("express");
const router = express.Router();

const { redirectShortLink } = require("../controllers/admin/shortLinkController");

router.get("/:code", redirectShortLink);

module.exports = router;
