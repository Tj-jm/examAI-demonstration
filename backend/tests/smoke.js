// Everything the sandboxed suites cannot reach: real persistence, real
// controller behaviour, real access resolution. Run this on a machine with
// mongod available.
//
//   npm run seed -- --force
//   npm run smoke
//
// It talks to a running server over http, so start `npm run dev` first.

require("dotenv").config();

const BASE = process.env.SMOKE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`;

let passed = 0;
let failed = 0;
let cookie = "";

const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
};

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, body: data };
};

const run = async () => {
  console.log(`\nRunning against ${BASE}\n`);

  const health = await call("GET", "/api/health");
  if (health.status !== 200) {
    console.error("Server is not responding. Start it with `npm run dev` first.");
    process.exit(1);
  }

  console.log("auth");
  {
    const bad = await call("POST", "/api/auth/login", {
      email: "owner@example.com",
      password: "wrong-password",
    });
    check("a wrong password is refused", bad.status === 401, bad.status);

    const good = await call("POST", "/api/auth/login", {
      email: "owner@example.com",
      password: "changeme123",
    });
    check("the seeded owner can sign in", good.status === 200, JSON.stringify(good.body));
    check("the role comes back", good.body && good.body.role === "owner");

    const me = await call("GET", "/api/auth/me");
    check("the session persists across requests", me.status === 200, me.status);

    const setup = await call("GET", "/api/auth/setup-state");
    check("setup has closed itself", setup.body && setup.body.needsSetup === false);

    const reopen = await call("POST", "/api/auth/setup", {
      name: "Intruder", email: "x@y.z", password: "password123",
    });
    check("setup cannot be reused to create a second owner", reopen.status === 403, reopen.status);
  }

  console.log("\ntaxonomy");
  let topicId;
  {
    const tree = await call("GET", "/api/taxonomy/tree");
    check("the tree loads", tree.status === 200, tree.status);
    check("the seed produced subjects", Array.isArray(tree.body) && tree.body.length > 0);

    const physics = (tree.body || []).find((s) => s.title === "Physics");
    check("physics is present with chapters", Boolean(physics && physics.chapters.length));

    topicId = physics && physics.chapters[0] && physics.chapters[0].topics[0]
      ? physics.chapters[0].topics[0]._id
      : null;
    check("a topic id is reachable from the tree", Boolean(topicId));

    const subjects = await call("GET", "/api/taxonomy/subjects");
    const first = subjects.body[0];
    const del = await call("DELETE", `/api/taxonomy/subjects/${first._id}`);
    check("a subject with content refuses deletion", del.status === 409, del.status);
    check("the refusal says what is in the way", /chapters|questions/i.test(del.body.message || ""), del.body.message);
  }

  console.log("\nquestions");
  let questionId;
  {
    const list = await call("GET", "/api/questions");
    check("the bank lists questions", list.status === 200 && list.body.total > 0, list.body && list.body.total);

    const mixed = list.body.questions.map((q) => q.type);
    check("all three types were seeded", ["mcq", "mtf", "written"].every((t) => mixed.includes(t)), mixed.join(","));

    questionId = list.body.questions[0]._id;

    // The cross-field rule a schema cannot enforce on its own.
    const bogus = await call("POST", "/api/questions", {
      type: "mcq",
      question: "Which of these is correct?",
      topic: topicId,
      options: [{ key: "A", text: "one" }, { key: "B", text: "two" }],
      correctOption: "Z",
    });
    check("an answer key naming no real option is refused", bogus.status === 400, bogus.status);

    const dup = await call("POST", "/api/questions", {
      type: "mcq",
      question: "Which of these is correct?",
      topic: topicId,
      options: [{ key: "A", text: "one" }, { key: "A", text: "two" }],
      correctOption: "A",
    });
    check("duplicate option keys are refused", dup.status === 400, dup.status);

    const created = await call("POST", "/api/questions", {
      type: "mcq",
      question: "A smoke test question. What is 2 + 2?",
      topic: topicId,
      marks: 1,
      options: [{ key: "A", text: "3" }, { key: "B", text: "4" }],
      correctOption: "B",
    });
    check("a well formed question is created", created.status === 201, JSON.stringify(created.body));

    const bulk = await call("POST", "/api/questions/bulk", {
      topicId,
      questions: [
        { type: "mcq", question: "Valid bulk question one?", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A" },
        { type: "mcq", question: "Broken bulk question?", options: [{ key: "A", text: "a" }], correctOption: "A" },
      ],
    });
    check("bulk import creates the valid rows", bulk.body && bulk.body.created === 1, bulk.body && bulk.body.created);
    check("bulk import reports why a row was rejected", Boolean(bulk.body && bulk.body.rejected.length === 1 && bulk.body.rejected[0].reason), JSON.stringify(bulk.body && bulk.body.rejected));
    check("the rejection names the row index", bulk.body.rejected[0].index === 1, bulk.body.rejected[0].index);
  }

  console.log("\nexams and assignment");
  {
    const exam = await call("POST", "/api/exams", {
      title: "Smoke test exam",
      durationMinutes: 30,
    });
    check("an exam is created", exam.status === 201, JSON.stringify(exam.body));

    const examId = exam.body._id;

    const publishEmpty = await call("PUT", `/api/exams/${examId}/publish`, { isPublished: true });
    check("an empty exam cannot be published", publishEmpty.status === 400, publishEmpty.status);

    const withQuestions = await call("PUT", `/api/exams/${examId}/questions`, {
      questionIds: [questionId],
    });
    check("questions are attached", withQuestions.status === 200, withQuestions.status);
    check("the total is a real sum", typeof withQuestions.body.summary.totalMarks === "number", JSON.stringify(withQuestions.body.summary));

    const twice = await call("PUT", `/api/exams/${examId}/questions`, {
      questionIds: [questionId, questionId],
    });
    check("the same question twice is refused", twice.status === 400, twice.status);

    const publishUnassigned = await call("PUT", `/api/exams/${examId}/publish`, { isPublished: true });
    check("an unassigned exam cannot be published", publishUnassigned.status === 400, publishUnassigned.status);

    const batches = await call("GET", "/api/batches");
    const batchId = batches.body[0]._id;

    const assign = await call("POST", `/api/batches/${batchId}/assigned/exams`, { ids: [examId] });
    check("the exam is assigned to a batch", assign.status === 200, JSON.stringify(assign.body));

    const again = await call("POST", `/api/batches/${batchId}/assigned/exams`, { ids: [examId] });
    check("assigning twice does not duplicate", again.body.modified === 0, again.body.modified);

    const publish = await call("PUT", `/api/exams/${examId}/publish`, { isPublished: true });
    check("a complete exam publishes", publish.status === 200, JSON.stringify(publish.body).slice(0, 120));

    const assigned = await call("GET", `/api/batches/${batchId}/assigned/exams`);
    check("the batch lists the exam", assigned.body.total >= 1, assigned.body.total);

    const del = await call("DELETE", `/api/questions/${questionId}`);
    check("a question used by an exam cannot be deleted", del.status === 409, del.status);
  }

  console.log("\nstudents and access");
  {
    const student = await call("POST", "/api/students", {
      name: "Smoke Student",
      email: `smoke-${Date.now()}@example.com`,
      password: "student123",
    });
    check("a student is created", student.status === 201, JSON.stringify(student.body));

    const studentId = student.body._id;
    const batches = await call("GET", "/api/batches");
    const paid = batches.body.find((b) => b.accessType === "paid");

    const enrol = await call("POST", `/api/students/${studentId}/enrol`, {
      batchId: paid._id,
      days: 30,
      note: "Smoke test grant",
    });
    check("a free grant is recorded as a zero price purchase", enrol.status === 201 && enrol.body.plan.price === 0, JSON.stringify(enrol.body && enrol.body.plan));

    const first = await call("POST", `/api/students/${studentId}/purchases`, {
      batchId: paid._id,
      planLabel: paid.plans[0].label,
      method: "Cash",
      transactionId: `SMOKE-${Date.now()}`,
    });
    check("a manual payment is recorded", first.status === 201, JSON.stringify(first.body).slice(0, 100));

    const badPlan = await call("POST", `/api/students/${studentId}/purchases`, {
      batchId: paid._id,
      planLabel: "A plan that does not exist",
    });
    check("an unknown plan is refused", badPlan.status === 400, badPlan.status);

    const detail = await call("GET", `/api/students/${studentId}`);
    check("access is resolved on the student record", Array.isArray(detail.body.access) && detail.body.access.length > 0, JSON.stringify(detail.body.access));
    check("the access window is active", detail.body.access.some((a) => a.isActive === true));
  }

  console.log("\nai configuration");
  {
    const config = await call("GET", "/api/ai/config");
    check("ai config loads", config.status === 200, config.status);
    check("no key is configured on a fresh install", config.body.hasApiKey === false);

    const saved = await call("PUT", "/api/ai/config", {
      provider: "custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      apiKey: "sk-smoke-test-key-1234",
      features: { writtenGrading: true },
    });
    check("settings save", saved.status === 200, saved.status);
    check("only the key tail is returned", saved.body.apiKeyLast4 === "1234" && saved.body.apiKey === undefined, JSON.stringify(saved.body).slice(0, 120));
    check("a small model warns about grading", saved.body.warnings.length > 0, JSON.stringify(saved.body.warnings));

    const partial = await call("PUT", "/api/ai/config", { model: "qwen2.5:32b" });
    check("saving other settings does not clear the key", partial.body.hasApiKey === true);
    check("a larger model drops the warning", partial.body.warnings.length === 0, JSON.stringify(partial.body.warnings));

    const usage = await call("GET", "/api/ai/usage");
    check("the usage dashboard responds", usage.status === 200, usage.status);
  }

  console.log("\n" + "-".repeat(60));
  console.log(`${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log("PASS");
};

run().catch((error) => {
  console.error("\nSmoke test crashed:", error.message);
  console.error("Is the server running, and has `npm run seed` been run?");
  process.exit(1);
});
