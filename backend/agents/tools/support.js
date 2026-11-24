const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");

// The support agent's actions: send a drafted answer to a doubt, or a
// drafted reply to a support ticket. Staff can edit the text first.
const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const short = (t, n = 90) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const tools = {
  answer_doubt: {
    label: "Answer a doubt",
    risk: "publish",
    editable: ["answer"],
    schema: z.object({
      doubtId: id,
      batchId: id,
      studentName: z.string().max(200),
      question: z.string().max(4000),
      answer: z.string().min(1).max(8000),
    }),
    batchesOf: (a) => [a.batchId],
    describe: (a) => `${a.studentName} asked: “${short(a.question)}”`,
    async run(a, ctx) {
      const Doubt = require("../../models/doubtModel");
      const d = await Doubt.findById(a.doubtId).select("status");
      if (!d) throw new Error("That doubt no longer exists.");
      if (d.status !== "escalated") return { summary: "Already answered by someone else; nothing sent." };
      const { resolveDoubt } = require("../../controllers/admin/doubtController");
      await call(resolveDoubt, { user: ctx.user, params: { id: a.doubtId }, body: { answer: a.answer } });
      return { summary: `Answer sent to ${a.studentName}.`, link: `/doubts` };
    },
  },

  reply_ticket: {
    label: "Reply to a support ticket",
    risk: "publish",
    editable: ["reply", "resolve"],
    schema: z.object({
      ticketId: id,
      studentName: z.string().max(200),
      subject: z.string().max(300),
      reply: z.string().min(1).max(5000),
      // Mark it resolved with the reply, or leave it waiting on the student.
      resolve: z.boolean().default(false),
    }),
    describe: (a) => `${a.studentName}: “${short(a.subject)}”${a.resolve ? " · and mark resolved" : ""}`,
    async run(a, ctx) {
      const Ticket = require("../../models/supportTicketModel");
      const t = await Ticket.findById(a.ticketId).select("messages status");
      if (!t) throw new Error("That ticket no longer exists.");
      const last = t.messages[t.messages.length - 1];
      if (last?.from === "staff") return { summary: "Someone already replied; nothing sent.", link: `/support/${a.ticketId}` };
      const { replyTicket } = require("../../controllers/admin/supportController");
      await call(replyTicket, { user: ctx.user, params: { id: a.ticketId }, body: { text: a.reply, status: a.resolve ? "resolved" : "waiting" } });
      return { summary: `Replied to ${a.studentName}${a.resolve ? " and resolved it" : ""}.`, link: `/support/${a.ticketId}` };
    },
  },
};

module.exports = { tools };
