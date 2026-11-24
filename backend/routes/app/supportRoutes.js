const express = require("express");
const router = express.Router();

const {
  listMyTickets, createTicket, getMyTicket, replyToTicket, resolveMyTicket, unreadCount, uploadTicketImage,
} = require("../../controllers/app/supportController");
const { studentProtect } = require("../../middleware/studentAuth");
const { uploadImage } = require("../../middleware/upload");

router.use(studentProtect);

router.get("/", listMyTickets);
router.post("/", createTicket);
router.get("/unread-count", unreadCount);
router.post("/upload-image", uploadImage, uploadTicketImage);
router.get("/:id", getMyTicket);
router.post("/:id/reply", replyToTicket);
router.put("/:id/resolve", resolveMyTicket);

module.exports = router;
