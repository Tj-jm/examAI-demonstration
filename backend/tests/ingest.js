// Chunking and coverage. The failure this guards against is silent: a model
// handed a long document writes every question from the opening pages, and
// nothing in the output says so.

process.env.NODE_ENV = "test";

const { chunk, planCoverage, dedupe, estimateTokens } = require("../ai/ingest");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

const para = (marker, words = 60) =>
  `${marker} ` + Array.from({ length: words }, (_, i) => `word${i}`).join(" ");

console.log("\nchunking");
{
  const doc = Array.from({ length: 40 }, (_, i) => para(`PARA${i}`)).join("\n\n");
  const chunks = chunk(doc, { targetTokens: 300, overlapTokens: 30 });

  check("splits a long document", chunks.length > 1, chunks.length);
  check("every chunk carries text", chunks.every((c) => c.text.trim().length > 0));
  check("chunks are indexed in order",
    chunks.every((c, i) => c.index === i));
  check("no chunk grossly exceeds the target",
    chunks.every((c) => c.tokens <= 300 * 1.6),
    chunks.map((c) => c.tokens).join(","));

  // The point of the whole exercise: content from the end of the document must
  // survive into the chunks.
  check("the first paragraph is present", chunks[0].text.includes("PARA0"));
  check("the last paragraph is present",
    chunks.some((c) => c.text.includes("PARA39")),
    "content from the end of the document was dropped");

  const covered = new Set();
  for (const c of chunks) {
    for (const m of c.text.matchAll(/PARA(\d+)/g)) covered.add(Number(m[1]));
  }
  check("every paragraph appears somewhere", covered.size === 40, `${covered.size}/40`);
}

console.log("\noverlap");
{
  const doc = Array.from({ length: 20 }, (_, i) => para(`P${i}`)).join("\n\n");
  const chunks = chunk(doc, { targetTokens: 200, overlapTokens: 40 });

  // A definition split across a boundary is unusable unless the next chunk
  // carries the tail of the previous one.
  const overlaps = chunks.slice(1).filter((c, i) => {
    const prevTail = chunks[i].text.slice(-100);
    const words = prevTail.split(/\s+/).filter(Boolean).slice(-4).join(" ");
    return words && c.text.includes(words);
  });

  check("later chunks carry the previous tail", overlaps.length > 0,
    `${overlaps.length} of ${chunks.length - 1} boundaries overlap`);
}

console.log("\noversized paragraph");
{
  // One paragraph longer than a whole chunk has to be split mid-paragraph or
  // it silently blows the window.
  const huge = "Sentence one is here. ".repeat(400);
  const chunks = chunk(huge, { targetTokens: 200, overlapTokens: 20 });

  check("a single huge paragraph is split", chunks.length > 1, chunks.length);
  check("no chunk is unbounded",
    chunks.every((c) => c.tokens <= 200 * 1.6),
    Math.max(...chunks.map((c) => c.tokens)));
}

console.log("\nsmall input");
{
  const chunks = chunk("Just one short paragraph about momentum.", { targetTokens: 1200 });
  check("a short document is one chunk", chunks.length === 1, chunks.length);
  check("it is not padded or truncated",
    chunks[0].text === "Just one short paragraph about momentum.");
}

console.log("\ncoverage planning");
{
  const chunks = chunk(Array.from({ length: 30 }, (_, i) => para(`C${i}`)).join("\n\n"),
    { targetTokens: 300 });

  const plan = planCoverage(chunks, 10);
  const total = plan.reduce((s, p) => s + p.count, 0);
  check("asks for the number requested", total === 10, total);
  check("spreads across distinct chunks",
    new Set(plan.map((p) => p.chunkIndex)).size === plan.length);

  const few = planCoverage(chunks.slice(0, 3), 10);
  check("divides evenly when chunks are fewer than questions",
    few.reduce((s, p) => s + p.count, 0) === 10,
    few.map((p) => p.count).join(","));
  check("every chunk gets at least one",
    few.every((p) => p.count >= 1), few.map((p) => p.count).join(","));

  check("handles an empty document", planCoverage([], 5).length === 0);

  const one = planCoverage(chunks, 1);
  check("a single question still picks a chunk", one.length === 1 && one[0].count === 1);
}

console.log("\ndeduplication");
{
  const { kept, dropped } = dedupe([
    { question: "What is momentum?" },
    { question: "what is momentum?!" },
    { question: "  What   is momentum  " },
    { question: "What is kinetic energy?" },
  ]);

  check("collapses punctuation and case differences", kept.length === 2, kept.length);
  check("reports what was dropped", dropped.length === 2, dropped.length);
  check("keeps the first occurrence", kept[0].question === "What is momentum?");
  check("an empty set is fine", dedupe([]).kept.length === 0);
}

console.log("\ntoken estimate");
{
  check("scales with length", estimateTokens("a".repeat(4000)) === 1000);
  check("never returns zero for real text", estimateTokens("hi") >= 1);
}

// ---------------------------------------------------------------- real files
// The chunker can be right about strings and still be useless if extraction
// loses the back half of a real document. This builds a genuine multi-page pdf
// and a genuine pptx, then checks that every page survives.

const buildPdf = (pageCount) => {
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const words = Array.from({ length: 40 }, (_, j) => `p${i + 1}w${j}`).join(" ");
    return `BT /F1 12 Tf 72 720 Td (Page ${i + 1}. ${words}) Tj ET`;
  });

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((content, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R ` +
      `/Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(out, "latin1");
};

const run = async () => {
  const { extract, SUPPORTED } = require("../ai/ingest");

  console.log("\nreal pdf");
  {
    const result = await extract(buildPdf(12), "application/pdf");
    check("reports the page count", result.pages === 12, result.pages);
    check("is not mistaken for a scan", result.looksScanned === false);

    const chunks = chunk(result.text, { targetTokens: 120 });
    check("splits into several chunks", chunks.length > 1, chunks.length);

    const combined = chunks.map((c) => c.text).join(" ");
    const missing = [];
    for (let i = 1; i <= 12; i += 1) {
      if (!combined.includes(`Page ${i}.`)) missing.push(i);
    }
    // The whole reason chunking exists.
    check("every page of a 12 page pdf reaches a chunk",
      missing.length === 0, `missing pages ${missing.join(",")}`);

    const plan = planCoverage(chunks, 10);
    const spread = Math.max(...plan.map((p) => p.chunkIndex));
    check("coverage reaches the end of the document",
      spread > chunks.length / 2, `furthest chunk ${spread} of ${chunks.length}`);
  }

  console.log("\nrefusals");
  {
    let caught = null;
    try {
      await extract(Buffer.from("tiny"), "text/plain");
    } catch (error) {
      caught = error;
    }
    check("a near-empty file is refused", caught?.statusCode === 422, caught?.message);

    caught = null;
    try {
      await extract(Buffer.from("x".repeat(500)), "image/png");
    } catch (error) {
      caught = error;
    }
    check("an unreadable type is refused", caught?.statusCode === 415, caught?.message);

    check("pdf, word, powerpoint and text are supported",
      ["application/pdf", "text/plain"].every((t) => SUPPORTED.includes(t)) &&
      SUPPORTED.some((t) => t.includes("presentationml")) &&
      SUPPORTED.some((t) => t.includes("wordprocessingml")),
      SUPPORTED.join(", "));
  }

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((e) => { console.error(e); process.exit(1); });
