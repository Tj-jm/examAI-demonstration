const { z } = require("zod");

// "Write with AI" for staff: exam descriptions, notices, landing page
// sections, live classes, a notice's push line, and translation. Each task
// turns its input into a prompt and names the shape it expects back. Facts
// (an exam's settings, a section's current text) come from the caller, so
// the model writes around them instead of inventing them.

const JSON_ONLY =
  "Return only a single JSON object. No prose, no markdown fences, no explanation before or after.";

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
// Languages staff can write and translate in (admin utils/languages.js).
const LANGUAGES = {
  en: "English",
  bn: "Bangla (Bengali script)",
  hi: "Hindi (Devanagari script)",
  ar: "Arabic",
  ur: "Urdu",
  es: "Spanish",
  fr: "French",
};
const lang = (language) => (LANGUAGES[language] && language !== "en"
  ? `Write in ${LANGUAGES[language]}. Keep numbers, units and names as they are.`
  : "Write in English.");
const STYLE = "Plain, warm and direct, the way a good teacher talks to students. No hype words (amazing, best, ultimate), no emoji, no exclamation marks.";

// ---------------------------------------------------------------- exam description

const minutes = (m) => (m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);

// The exam's real settings, as plain sentences the model must not contradict.
const examFacts = (e) => {
  const facts = [];
  if (e.title) facts.push(`Title: ${clip(e.title, 200)}`);
  facts.push(`Type: ${{ quiz: "quiz", mock: "mock exam", test: "test" }[e.mode] || "test"}`);
  if (e.durationMinutes) facts.push(`Time allowed once started: ${minutes(Number(e.durationMinutes))}`);
  if (e.questionCount) facts.push(`Questions: ${e.questionCount}`);
  if (e.totalMarks) facts.push(`Total marks: ${e.totalMarks}`);
  if (e.types?.length) facts.push(`Question types: ${e.types.join(", ")}`);
  if (e.attemptsAllowed) facts.push(`Attempts allowed: ${e.attemptsAllowed}`);
  if (e.opensAt) facts.push(`Opens: ${new Date(e.opensAt).toUTCString()}`);
  if (e.liveHours) facts.push(`Stays open for: ${e.liveHours} hours after opening`);
  if (e.shuffleQuestions) facts.push("Questions are shown in a different order for each student");
  facts.push(e.showResultImmediately ? "Results: shown as soon as the student submits" : "Results: shown after the teachers release them");
  if (e.hasWritten && e.scriptGraceMinutes) facts.push(`Written answers: photos of the answer script can be uploaded for ${e.scriptGraceMinutes} minutes after time is up`);
  if (e.awayMode === "submit") facts.push(`Leaving the exam screen for more than ${e.awayMinutes || 5} minutes submits the exam automatically`);
  else if (e.awayMode === "abandon") facts.push(`Leaving the exam screen for more than ${e.awayMinutes || 5} minutes cancels the attempt`);
  else facts.push("Leaving the exam screen is recorded and teachers can see it");
  return facts;
};

const examDescription = {
  schema: z.object({ description: z.string().min(1).max(1500) }),
  build: ({ exam = {}, prompt, language }) => ({
    system: [
      "You write the description students read on an exam's rules screen before they start.",
      "Use only the facts given. Never add a rule, time, mark or date that is not in the facts. Never say anything about negative marking, calculators or materials unless the teacher's note mentions it.",
      STYLE, lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `Exam facts:
${examFacts(exam).map((f) => `- ${f}`).join("\n")}
${prompt ? `\nTeacher's note: ${clip(prompt, 600)}\n` : ""}
Write the description in Markdown: one short opening sentence about what the exam covers or is for, then a "Before you start" list of 3-7 short bullets with the rules that matter most to a student (time, attempts, leaving the screen, results, written answers). Under 900 characters.

Shape:
{ "description": "..." }`,
  }),
};

// ---------------------------------------------------------------- notice

const notice = {
  schema: z.object({
    title: z.string().min(1).max(120),
    bodyMarkdown: z.string().min(1).max(3000),
    pushText: z.string().min(1).max(140),
  }),
  build: ({ prompt, noticeType, batchNames = [], siteName, language }) => ({
    system: [
      "You write notices an education platform posts to its students.",
      "Keep every date, time, amount and name exactly as the staff member gave it. Do not invent details they did not give; leave a detail out rather than guess it.",
      STYLE, lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `Platform: ${clip(siteName, 80) || "the platform"}
Who sees it: ${noticeType === "batch" && batchNames.length ? `students in ${batchNames.slice(0, 5).join(", ")}` : "every student"}
What the notice is about: ${clip(prompt, 1500)}

Write:
- title: under 70 characters, says what it is about.
- bodyMarkdown: the notice in Markdown, 2-6 short sentences or a short list. Lead with what students need to do or know.
- pushText: one line under 110 characters for the phone notification, saying the key point.

Shape:
{ "title": "...", "bodyMarkdown": "...", "pushText": "..." }`,
  }),
};

const pushLine = {
  schema: z.object({ pushText: z.string().min(1).max(140) }),
  build: ({ title, body, language }) => ({
    system: ["You write the one-line phone notification for a notice.", STYLE, lang(language), JSON_ONLY].join(" "),
    prompt: `Notice title: ${clip(title, 200)}
Notice:
${clip(body, 3000)}

Write pushText: one line under 110 characters with the key point a student needs, not a repeat of the title.

Shape:
{ "pushText": "..." }`,
  }),
};

// ---------------------------------------------------------------- campaign

const AUDIENCE_WORDS = {
  all: "every student",
  batch: "students in one course",
  neverBought: "students who signed up but never bought anything",
  trialEnding: "students whose free trial ends soon",
  expired: "students whose access ran out recently",
  inactive: "students who haven't used the app for a while",
  checkoutAbandoned: "students who started paying for a course but didn't finish",
  accessExpiring: "students whose access to a course ends in a few days",
  accessExpired: "students whose access to a course ended a few days ago",
  noPurchase: "students who signed up a few days ago and haven't joined a course",
};

// Automations about one course can name it.
const BATCH_TRIGGERS = ["trialEnding", "checkoutAbandoned", "accessExpiring", "accessExpired"];

const campaign = {
  schema: z.object({
    title: z.string().min(1).max(120),
    message: z.string().min(1).max(600),
  }),
  build: ({ prompt, audience, batchName, couponCode, sms, automation, siteName, language }) => ({
    system: [
      "You write short messages an education platform sends its students: an offer, a reminder or news.",
      "Keep every date, price, discount and name exactly as the staff member gave it. Do not invent offers, deadlines or numbers they did not give.",
      "Honest and specific; no pressure tactics, no fake urgency.",
      STYLE, lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `Platform: ${clip(siteName, 80) || "the platform"}
Who gets it: ${AUDIENCE_WORDS[audience] || AUDIENCE_WORDS.all}${batchName ? ` (${clip(batchName, 80)})` : ""}
${couponCode ? `A code is added after the message automatically: ${clip(couponCode, 40)}. Mention there is a code; don't repeat it.\n` : ""}What it's about: ${clip(prompt, 1500)}

${automation ? `This goes out by itself to each student when it applies to them, so don't mention dates.${BATCH_TRIGGERS.includes(audience) ? " Write {batch} where the course's name should go." : ""}\n` : ""}Write:
- title: under 60 characters, for the notification and email subject.
- message: ${sms ? "2-3 sentences, under 280 characters, because it also goes by SMS" : "2-4 short sentences"}. Start with {name}, (the student's first name goes there), then the point and what to do. A link to the page is added after it automatically.

Shape:
{ "title": "...", "message": "..." }`,
  }),
};

// ---------------------------------------------------------------- poster

const POSTER_KIND = {
  batch: "announcing a new course that is open for admission",
  results: "celebrating the top scorers of an exam",
  offer: "an admission offer: a discount or deal for joining a course",
  greeting: "a greeting from the centre to its students and their families for a festival or special day. Warm and respectful, not an advertisement: no prices or sales talk",
  general: "a general post on what the staff member describes",
};

const poster = {
  schema: z.object({
    headline: z.string().min(1).max(80),
    subline: z.string().max(160).default(""),
    points: z.array(z.string().max(70)).max(4).default([]),
    cta: z.string().max(40).default(""),
    caption: z.string().min(1).max(1500),
    // The picture to go with it (for the image model), and what a voice
    // reads over the promo video.
    imagePrompt: z.string().max(400).default(""),
    voiceover: z.string().max(700).default(""),
  }),
  build: ({ kind, facts = [], prompt, siteName, language }) => ({
    system: [
      "You write social media posts and poster text for a coaching centre or school, for Facebook and similar.",
      "Use only the facts given. Keep every name, number, price, date, mark and discount exactly as given; never invent any.",
      "Warm and confident, the way a good centre speaks to students and parents. No fake urgency.",
      "Emoji are fine in the caption only, a few at most. None in the poster text.",
      lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `Centre: ${clip(siteName, 80) || "the centre"}
Post: ${POSTER_KIND[kind] || POSTER_KIND.batch}
Facts:
${facts.map((f) => `- ${clip(f, 300)}`).join("\n") || "- (none)"}
${prompt ? `What the staff member wants: ${clip(prompt, 800)}\n` : ""}
Write:
- headline: the poster's big line, under 40 characters.
- subline: one line under the headline, under 90 characters.
- points: up to 4 short lines for the poster (what's included, the offer, key dates), each under 50 characters.${kind === "results" ? " Leave empty: the scorers are listed on the poster." : ""}
- cta: 2-5 words, what to do (e.g. "Enrol now").${kind === "greeting" ? " May be empty for a greeting." : ""}
- caption: the Facebook post text, 3-6 short lines, ending with what to do next and 2-4 hashtags.${kind === "greeting" ? " For a greeting, end with the wish instead of a call to buy." : ""}
- imagePrompt: in English, one or two sentences describing a picture to go with the post: the scene only (people, place, objects, colours, mood), true to the occasion and culture. No words, letters or logos in it.
- voiceover: what a friendly voice says over a 15-second promo video of this post: 2-4 short spoken sentences, in the same language as the post, ending with the call to action (or the wish).

Shape:
{ "headline": "...", "subline": "...", "points": ["..."], "cta": "...", "caption": "...", "imagePrompt": "...", "voiceover": "..." }`,
  }),
};

// ---------------------------------------------------------------- landing page

const LANDING = {
  hero: {
    shape: '{ "heading": "...", "subheading": "...", "ctaLabel": "..." }',
    ask: "heading: under 60 characters. subheading: one or two sentences under 180 characters on what a student gets. ctaLabel: 2-3 words for the button.",
    schema: z.object({ heading: z.string().min(1).max(90), subheading: z.string().min(1).max(260), ctaLabel: z.string().min(1).max(30) }),
  },
  about: {
    shape: '{ "heading": "...", "body": "..." }',
    ask: "heading: under 50 characters. body: Markdown, 2-3 short paragraphs about who the institution is, how it teaches and who it is for.",
    schema: z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(2000) }),
  },
  faq: {
    shape: '{ "heading": "...", "items": [{ "q": "...", "a": "..." }] }',
    ask: "heading: under 50 characters. items: 4-6 questions a parent or student would really ask before joining, each answer 1-3 sentences.",
    schema: z.object({ heading: z.string().min(1).max(80), items: z.array(z.object({ q: z.string().min(1).max(200), a: z.string().min(1).max(600) })).min(1).max(8) }),
  },
  catalogue: {
    shape: '{ "heading": "...", "subheading": "..." }',
    ask: "heading: under 50 characters, introduces the courses. subheading: one sentence under 140 characters.",
    schema: z.object({ heading: z.string().min(1).max(80), subheading: z.string().min(1).max(200) }),
  },
  footer: {
    shape: '{ "text": "..." }',
    ask: "text: one short line, a tagline or copyright line, under 120 characters.",
    schema: z.object({ text: z.string().min(1).max(200) }),
  },
  heading: {
    shape: '{ "heading": "..." }',
    ask: "heading: under 50 characters.",
    schema: z.object({ heading: z.string().min(1).max(80) }),
  },
};
const landingKind = (section) => LANDING[section] || LANDING.heading;

const landingSection = {
  schema: (input) => landingKind(input.section).schema,
  build: ({ section, prompt, current, siteName, language }) => {
    const kind = landingKind(section);
    return {
      system: [
        "You write the public landing page of an education platform: the page a prospective student or parent sees first.",
        "Specific and believable. Never invent numbers, results, awards or testimonials; if the staff member gave figures, use them exactly.",
        STYLE, lang(language), JSON_ONLY,
      ].join(" "),
      prompt: `Platform: ${clip(siteName, 80) || "the platform"}
Section: ${section}
About the institution / what to say: ${clip(prompt, 1500) || "(nothing given; keep it general and honest)"}
${current ? `Current text, to improve on: ${clip(JSON.stringify(current), 1500)}\n` : ""}
Write: ${kind.ask}

Shape:
${kind.shape}`,
    };
  },
};

// ---------------------------------------------------------------- live class

const liveClass = {
  schema: z.object({ title: z.string().min(1).max(120), description: z.string().min(1).max(1200) }),
  build: ({ prompt, batchName, durationMinutes, mode, language }) => ({
    system: ["You write the title and short agenda of an online class, shown to students before it starts.", STYLE, lang(language), JSON_ONLY].join(" "),
    prompt: `${mode === "webinar" ? "Webinar" : "Class"} for: ${clip(batchName, 120) || "a batch"}
${durationMinutes ? `Length: ${minutes(Number(durationMinutes))}\n` : ""}What it covers: ${clip(prompt, 1200)}

Write:
- title: under 70 characters, names the topic.
- description: Markdown, one sentence on what students will be able to do afterwards, then a 3-5 bullet agenda, then one line on what to bring or revise beforehand if it helps.

Shape:
{ "title": "...", "description": "..." }`,
  }),
};

// ---------------------------------------------------------------- course description

// A batch's or program's catalogue description, from what it really has
// (ai/courseFacts.js), improving the current text when there is one.
const courseDescription = {
  schema: z.object({ description: z.string().min(1).max(2500) }),
  build: ({ kind, course = {}, prompt, language }) => ({
    system: [
      `You write the description of a ${kind === "program" ? "program (a group of batches)" : "batch (a course)"} shown to students in a course catalogue before they buy or join.`,
      "Use only the facts given and the teacher's note. Never invent results, success rates, student numbers, teacher names, dates, prices or features. A count or price may only appear if it is in the facts.",
      STYLE, lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `Facts:
${(course.facts || []).map((f) => `- ${clip(f, 600)}`).join("\n")}
${course.current ? `\nCurrent description (keep what is true and useful, improve the rest):\n${clip(course.current, 2000)}\n` : ""}${prompt ? `\nTeacher's note: ${clip(prompt, 600)}\n` : ""}
Write the description in Markdown: one or two sentences on what ${kind === "program" ? "the program" : "the batch"} is and who it is for, then a "What's included" list of 3-7 short bullets from the facts${kind === "program" ? " (name the batches)" : " (subjects and chapters, lectures, practice, exams, live classes, other help)"}, then one closing line on how to start. Under 1200 characters.

Shape:
{ "description": "..." }`,
  }),
};

// ---------------------------------------------------------------- conduct message

// What a student reads when staff act on their conduct: a warning, a
// disqualification, a pause or suspension, or lifting one.
const CONDUCT_ACTION = {
  warn: "a warning about their behaviour",
  disqualify: "the reason their exam attempt was disqualified",
  pauseAi: "a notice that their AI features are paused",
  resumeAi: "a notice that their AI features are back on",
  suspend: "a notice that their account is suspended",
  reactivate: "a notice that their account is active again",
};
const conductMessage = {
  schema: z.object({ message: z.string().min(1).max(1500) }),
  build: ({ action, days, facts = [], prompt, language }) => ({
    system: [
      `You write ${CONDUCT_ACTION[action] || CONDUCT_ACTION.warn}, sent to a student by their institution's staff.`,
      "Firm, fair and respectful: say plainly what happened and what it means for them, without insults, threats or lecturing. Use only the facts given and the staff note; never invent incidents, rules or penalties. For a warning or a restriction, end with what they should do from now on and that they can reply through support if they think it is a mistake.",
      "No hype words, no emoji, no exclamation marks.", lang(language), JSON_ONLY,
    ].join(" "),
    prompt: `${days !== undefined && days !== null && days !== "" ? `Length: ${Number(days) > 0 ? `${Number(days)} day${Number(days) === 1 ? "" : "s"}` : action === "suspend" ? "permanent" : "until staff lift it"}\n` : ""}Facts:
${facts.length ? facts.map((f) => `- ${clip(f, 400)}`).join("\n") : "- (none given)"}
${prompt ? `\nStaff note: ${clip(prompt, 800)}\n` : ""}
Write the message: 2-5 short sentences, addressed to the student, under 700 characters.

Shape:
{ "message": "..." }`,
  }),
};

// ---------------------------------------------------------------- translate

const BANGLA = /[ঀ-৿]/;
const translate = {
  schema: z.object({ text: z.string().min(1).max(8000) }),
  build: ({ text, to }) => {
    const target = LANGUAGES[to] ? to : BANGLA.test(String(text)) ? "en" : "bn";
    return {
      system: [
        `You translate text for an education platform into ${LANGUAGES[target]}.`,
        "Keep the meaning, tone and Markdown formatting exactly. Keep numbers, dates, names, LaTeX ($...$) and links unchanged. Translate naturally, the way a teacher who speaks it would write it, not word for word.",
        JSON_ONLY,
      ].join(" "),
      prompt: `Translate:
${clip(text, 6000)}

Shape:
{ "text": "..." }`,
    };
  },
};

// ---------------------------------------------------------------- format

// Pasted text (from a document, a PDF, a chat) turned into tidy Markdown.
// The words stay the author's: only the structure changes.
const FORMAT_LIMIT = 20000;
const format = {
  schema: z.object({ text: z.string().min(1).max(FORMAT_LIMIT * 2) }),
  build: ({ text }) => ({
    system: [
      "You format pasted text as clean Markdown for an education platform.",
      "Keep every sentence, fact, number and name. Never add, drop, summarise or reword content, and never translate it. Fix only broken line wraps, stray spaces and bullet characters left over from copying.",
      "Use: '## ' and '### ' headings where the text has sections, '- ' bullets and '1. ' numbered lists, '- [ ] ' for checklists, **bold** for key terms, '> ' for quotes or notes, pipe tables (with a '| --- |' row) for tabular data, ``` fences for code, and LaTeX in $...$ (inline) or $$...$$ (on its own line) for maths and formulas. Links as [text](url).",
      "No raw HTML. Leave a blank line between blocks.",
      JSON_ONLY,
    ].join(" "),
    prompt: `Format:
${clip(text, FORMAT_LIMIT)}

Shape:
{ "text": "..." }`,
  }),
};

const TASKS = { examDescription, notice, pushLine, campaign, poster, landingSection, liveClass, courseDescription, conductMessage, translate, format };

// The prompt and the schema for one task. Throws on an unknown task.
const writingTask = (task, input) => {
  const t = TASKS[task];
  if (!t) throw Object.assign(new Error("Unknown writing task."), { statusCode: 400 });
  const schema = typeof t.schema === "function" ? t.schema(input) : t.schema;
  return { schema, ...t.build(input) };
};

module.exports = { FORMAT_LIMIT, writingTask, WRITING_TASKS: Object.keys(TASKS), WRITING_LANGUAGES: Object.keys(LANGUAGES), examFacts };
