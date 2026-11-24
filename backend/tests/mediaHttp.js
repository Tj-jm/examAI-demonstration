// Upload and ingest over real http through the real app, including the multer
// layer. Auth is bypassed by stubbing the guard, because the guard itself is
// covered by the route audit and the http suite.
process.env.NODE_ENV = "test";
process.env.SERVE_STATIC = "false";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_PATH = require("os").tmpdir() + "/examai-upload-test";
process.env.JWT_SECRET = "x".repeat(48);
process.env.ENCRYPTION_KEY = "a".repeat(64);

const fs = require("fs");
const request = require("supertest");

const adminAuth = require("../middleware/adminAuth");
const realProtect = adminAuth.protect;
adminAuth.protect = (req, res, next) => {
  req.user = { _id: "6500000000000000000000aa", role: "owner" };
  next();
};
adminAuth.protect.isAuthGuard = true;

// Media.findOne / create need a db; stub the model instead.
const Media = require("../models/mediaModel");
const store = new Map();
Media.findOne = async (q) => [...store.values()].find(m => m.key === q.key && m.driver === q.driver) || null;
Media.create = async (doc) => {
  const made = { ...doc, _id: String(store.size + 1), toObject() { const {toObject, ...r} = this; return r; } };
  store.set(made._id, made);
  return made;
};
Media.countDocuments = async (q) =>
  [...store.values()].filter(m => m.key === q.key && m.driver === q.driver).length;

// Document (the ingest library) needs the same treatment: preview and
// generate-from-document both look up and create Document rows now.
const Document = require("../models/documentModel");
const documentStore = new Map();
Document.findOne = async (q) =>
  [...documentStore.values()].find((d) => d.contentHash === q.contentHash) || null;
Document.findById = async (id) => documentStore.get(String(id)) || null;
// Shared between find and countDocuments — the pagination added to
// getDocuments (ingestController.js) counts the very same filtered set it
// pages through, so both need to agree on what "matches the query" means.
const matchesDocumentQuery = (d, query = {}) => {
  if (!query.$or) return true;
  return query.$or.some((clause) =>
    Object.entries(clause).some(([field, matcher]) => {
      if (matcher && matcher.$regex) return new RegExp(matcher.$regex, matcher.$options).test(d[field] || "");
      return d[field] === matcher;
    })
  );
};

Document.find = (query = {}) => {
  const results = [...documentStore.values()].filter((d) => matchesDocumentQuery(d, query));

  let selectSpec = null;
  let sortSpec = null;
  let skipN = 0;
  let limitN = null;

  const builder = {
    select(spec) { selectSpec = spec; return builder; },
    sort(spec) { sortSpec = spec; return builder; },
    skip(n) { skipN = n; return builder; },
    limit(n) { limitN = n; return builder; },
    then(resolve, reject) {
      try {
        let out = [...results];
        if (sortSpec) {
          const entries = Object.entries(sortSpec);
          out.sort((a, b) => {
            for (const [key, dir] of entries) {
              const av = a[key] instanceof Date ? a[key].getTime() : a[key] || 0;
              const bv = b[key] instanceof Date ? b[key].getTime() : b[key] || 0;
              if (av !== bv) return dir === -1 ? bv - av : av - bv;
            }
            return 0;
          });
        }
        if (skipN) out = out.slice(skipN);
        if (limitN) out = out.slice(0, limitN);
        if (typeof selectSpec === "string" && selectSpec.trim().startsWith("-")) {
          const excluded = selectSpec.trim().split(/\s+/).map((f) => f.replace(/^-/, ""));
          out = out.map((doc) => {
            const copy = { ...doc };
            excluded.forEach((f) => delete copy[f]);
            return copy;
          });
        }
        resolve(out);
      } catch (error) {
        reject(error);
      }
    },
  };

  return builder;
};
Document.countDocuments = async (query = {}) =>
  [...documentStore.values()].filter((d) => matchesDocumentQuery(d, query)).length;
Document.create = async (doc) => {
  const made = {
    usedCount: 0,
    ...doc,
    _id: String(documentStore.size + 1),
    save: async function () { documentStore.set(this._id, this); return this; },
    deleteOne: async function () { documentStore.delete(this._id); },
  };
  documentStore.set(made._id, made);
  return made;
};

const app = require("../app")();

let pass = 0, fail = 0;
const check = (l, ok, d) => { if (ok) { pass++; console.log("  ok    " + l); } else { fail++; console.log("  FAIL  " + l + (d !== undefined ? " — " + d : "")); } };

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

(async () => {
  fs.rmSync(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });

  console.log("\nupload endpoint");
  {
    const r = await request(app).post("/api/media/upload")
      .field("folder", "questions").attach("file", PNG, "diagram.png");
    check("accepts a png", r.status === 201, r.status + " " + JSON.stringify(r.body).slice(0,120));
    check("returns a servable url", /^\/media\/questions\//.test(r.body.url || ""), r.body.url);
    check("records the kind", r.body.kind === "image", r.body.kind);

    const again = await request(app).post("/api/media/upload")
      .field("folder", "questions").attach("file", PNG, "same-bytes-other-name.png");
    check("the same bytes are deduplicated", again.body.deduplicated === true);
    check("and reuse the same record", again.body._id === r.body._id);
  }

  console.log("\nupload refusals");
  {
    const svg = await request(app).post("/api/media/upload").attach("file", Buffer.from("<svg/>"), "x.svg");
    check("svg is refused", svg.status === 415, svg.status);

    const big = await request(app).post("/api/media/upload")
      .attach("file", Buffer.alloc(31 * 1024 * 1024), "big.png");
    check("an oversized file is refused", big.status === 413, big.status);

    const none = await request(app).post("/api/media/upload");
    check("a missing file is a 400", none.status === 400, none.status);
  }

  console.log("\nserving the file back");
  {
    const up = await request(app).post("/api/media/upload").attach("file", PNG, "served.png");
    const got = await request(app).get(up.body.url);
    check("the url actually serves the file", got.status === 200, got.status);
    check("bytes round-trip unchanged", Buffer.compare(got.body, PNG) === 0);
    check("cached as immutable", /immutable/.test(got.headers["cache-control"] || ""), got.headers["cache-control"]);
  }

  console.log("\nvideo linking");
  {
    const yt = await request(app).post("/api/media/video")
      .send({ provider: "youtube", input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    check("a youtube link is accepted", yt.status === 201, yt.status + " " + JSON.stringify(yt.body).slice(0,100));
    check("the id is extracted", yt.body.key === "dQw4w9WgXcQ", yt.body.key);
    check("an embed url comes back", (yt.body.url||"").includes("youtube-nocookie"), yt.body.url);

    const bad = await request(app).post("/api/media/video").send({ provider: "youtube", input: "not a link" });
    check("nonsense is refused", bad.status === 400, bad.status);

    const bunny = await request(app).post("/api/media/video").send({ provider: "bunny", input: "abc" });
    check("unconfigured bunny explains itself", bunny.status === 400 && /BUNNY_LIBRARY_ID/.test(bunny.body.message), bunny.body.message);
  }

  console.log("\ningest preview");
  {
    const txt = Buffer.from("Momentum is mass times velocity. ".repeat(60));
    const r = await request(app).post("/api/ai/ingest/preview").attach("file", txt, "notes.txt");
    check("reads a text file", r.status === 200, r.status + " " + JSON.stringify(r.body).slice(0,120));
    check("reports chunk count", typeof r.body.chunks === "number" && r.body.chunks >= 1, r.body.chunks);
    check("suggests a question count", r.body.suggestedQuestions >= 5, r.body.suggestedQuestions);

    const tiny = await request(app).post("/api/ai/ingest/preview").attach("file", Buffer.from("hi"), "t.txt");
    check("a near-empty file is refused", tiny.status === 422, tiny.status);

    const wrong = await request(app).post("/api/ai/ingest/preview").attach("file", PNG, "a.png");
    check("an image is refused for ingestion", wrong.status === 415, wrong.status);
  }

  console.log("\ndocument library");
  {
    const bytes = Buffer.from("Photosynthesis converts light into chemical energy. ".repeat(60));

    const first = await request(app).post("/api/ai/ingest/preview").attach("file", bytes, "bio.txt");
    check("preview returns a documentId", typeof first.body.documentId === "string", first.body.documentId);

    const again = await request(app).post("/api/ai/ingest/preview").attach("file", bytes, "renamed-copy.txt");
    check("the same bytes reuse the same library entry",
      again.body.documentId === first.body.documentId,
      `${again.body.documentId} vs ${first.body.documentId}`);

    const list = await request(app).get("/api/ai/documents");
    check("it appears in the library list", list.status === 200 && list.body.documents.length >= 1, list.status);
    const entry = list.body.documents.find((d) => d._id === first.body.documentId);
    check("the listing carries chunk metadata", entry && entry.chunkCount >= 1, entry?.chunkCount);
    check("the listing does not carry the full extracted text",
      entry && entry.extractedText === undefined, entry?.extractedText);

    const removed = await request(app).delete(`/api/ai/documents/${first.body.documentId}`);
    check("it can be removed", removed.status === 200, removed.status);

    const after = await request(app).get("/api/ai/documents");
    check("it is gone from the list", !after.body.documents.some((d) => d._id === first.body.documentId));

    const missing = await request(app).delete(`/api/ai/documents/${first.body.documentId}`);
    check("removing it again is a 404", missing.status === 404, missing.status);
  }

  console.log("\nattaching a library document to a lecture");
  {
    const bytes = Buffer.from("Cell division has two phases: mitosis and meiosis. ".repeat(60));
    const preview = await request(app).post("/api/ai/ingest/preview").attach("file", bytes, "cell-division.txt");
    const documentId = preview.body.documentId;

    const attached = await request(app).post(`/api/media/from-document/${documentId}`).send({});
    check("promotes the document to a media item", attached.status === 201, attached.status);
    check("carries the document kind", attached.body.kind === "document", attached.body.kind);
    check("keeps the document's title", attached.body.title === "cell-division", attached.body.title);
    check("resolves to a servable url", typeof attached.body.url === "string" && attached.body.url.length > 0, attached.body.url);

    const again = await request(app).post(`/api/media/from-document/${documentId}`).send({});
    check("attaching it twice reuses the same media record", again.body._id === attached.body._id);

    const bogus = await request(app).post("/api/media/from-document/999").send({});
    check("an unknown document is a 404", bogus.status === 404, bogus.status);

    // Deleting the library entry after it has been promoted to an attachment
    // must not pull the file out from under the lecture still pointing at it.
    const removeAttached = await request(app).delete(`/api/ai/documents/${documentId}`);
    check("the library entry itself can still be removed", removeAttached.status === 200, removeAttached.status);
    const stillServed = await request(app).get(attached.body.url);
    check("the underlying file survives because a media record still uses it",
      stillServed.status === 200, stillServed.status);
  }

  console.log("\nlecture attachment uploads");
  {
    const docx = Buffer.from("PK\x03\x04fake-docx-bytes");
    const r = await request(app).post("/api/media/upload")
      .field("folder", "lectures")
      .attach("file", docx, { filename: "handout.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    check("a docx is accepted for a lecture", r.status === 201, r.status + " " + JSON.stringify(r.body).slice(0, 120));
    check("recorded with the document kind", r.body.kind === "document", r.body.kind);
    check("filed under the lectures folder", /^\/media\/lectures\//.test(r.body.url || ""), r.body.url);

    const zip = await request(app).post("/api/media/upload")
      .field("folder", "lectures")
      .attach("file", Buffer.from("PK\x03\x04"), { filename: "archive.zip", contentType: "application/zip" });
    check("a zip is still refused", zip.status === 415, zip.status);
  }

  console.log("\nproviders endpoint");
  {
    const r = await request(app).get("/api/media/providers");
    check("lists video providers", r.body.video?.length === 5, r.body.video?.length);
    check("reports the storage driver", r.body.storage?.driver === "local", r.body.storage?.driver);
    check("states the size limits", r.body.storage?.maxImageMb === 8, r.body.storage?.maxImageMb);
  }

  fs.rmSync(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });
  adminAuth.protect = realProtect;

  console.log("\n" + "-".repeat(50));
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();