// Storage and video adapters. The local driver is exercised against a real
// temporary directory, because path handling is where this kind of code goes
// wrong and a mocked filesystem would hide it.

process.env.NODE_ENV = "test";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_PATH = require("os").tmpdir() + "/examai-storage-test";

const fs = require("fs");
const path = require("path");
const storage = require("../adapters/storage");
const video = require("../adapters/video");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

// A one pixel png, so the bytes are a real image rather than arbitrary noise.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const file = (buffer, mimetype, name = "test.png") => ({
  buffer, mimetype, originalname: name, size: buffer.length,
});

const run = async () => {
  fs.rmSync(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });

  console.log("\nlocal driver");
  {
    const stored = await storage.store("questions", file(PNG, "image/png"));
    check("stores a png", Boolean(stored.key), JSON.stringify(stored));
    check("filed under the folder given", stored.key.startsWith("questions/"), stored.key);
    check("reports the kind", stored.kind === "image", stored.kind);

    const full = path.join(process.env.STORAGE_LOCAL_PATH, stored.key);
    check("the file is really on disk", fs.existsSync(full));
    check("the bytes are unchanged", fs.readFileSync(full).equals(PNG));

    const url = await storage.urlFor(stored.key, "local");
    check("serves a relative url", url === `/media/${stored.key}`, url);

    // Content addressing: the same bytes must land on the same key, so a
    // teacher pasting one diagram into twenty questions stores it once.
    const again = await storage.store("questions", file(PNG, "image/png", "other-name.png"));
    check("the same bytes reuse the same key", again.key === stored.key);
    check("a repeat upload is recognised", again.deduplicated === true);

    const different = await storage.store(
      "questions",
      file(Buffer.concat([PNG, Buffer.from([0])]), "image/png")
    );
    check("different bytes get a different key", different.key !== stored.key);

    await storage.remove(stored.key, "local");
    check("removes the file", !fs.existsSync(full));

    let threw = false;
    try { await storage.remove(stored.key, "local"); } catch { threw = true; }
    check("removing twice is not an error", !threw);
  }

  console.log("\nrefusals");
  {
    const reject = async (label, f, expectStatus) => {
      try {
        await storage.store("general", f);
        check(label, false, "was accepted");
      } catch (error) {
        check(label, error.statusCode === expectStatus, `status ${error.statusCode}: ${error.message}`);
      }
    };

    // Svg can carry script and these files are served from the same origin as
    // the session cookie.
    await reject("svg is refused", file(Buffer.from("<svg/>"), "image/svg+xml"), 415);
    await reject("html is refused", file(Buffer.from("<html>"), "text/html"), 415);
    await reject("an oversized image is refused",
      file(Buffer.alloc(9 * 1024 * 1024), "image/png"), 413);

    const pdf = await storage.store("general", file(Buffer.alloc(1000), "application/pdf"));
    check("a pdf is accepted", pdf.kind === "pdf", pdf.kind);

    const docx = await storage.store(
      "lectures",
      file(Buffer.alloc(1000), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "notes.docx")
    );
    check("a docx is accepted", docx.kind === "document", docx.kind);
    check("keyed with the right extension", docx.key.endsWith(".docx"), docx.key);

    const md = await storage.store("lectures", file(Buffer.from("# hi"), "text/markdown", "notes.md"));
    check("markdown is accepted", md.kind === "document", md.kind);

    await reject("an oversized document is refused",
      file(Buffer.alloc(26 * 1024 * 1024), "text/plain", "big.txt"), 413);
  }

  console.log("\npath traversal");
  {
    const local = storage.DRIVERS.local;

    // A marker file that cannot already exist, so its absence proves the write
    // was stopped rather than proving something about the host filesystem.
    const marker = `examai-escaped-${Date.now()}.txt`;

    for (const attempt of [
      `../${marker}`,
      `../../${marker}`,
      `questions/../../${marker}`,
      `./../${marker}`,
    ]) {
      let threw = false;
      try {
        await local.put(attempt, Buffer.from("x"));
      } catch {
        threw = true;
      }
      check(`refuses "${attempt}"`, threw);
    }

    check("nothing was written outside the uploads directory",
      !fs.existsSync(path.resolve(process.env.STORAGE_LOCAL_PATH, "..", marker)) &&
      !fs.existsSync(path.resolve(process.env.STORAGE_LOCAL_PATH, "../..", marker)));

    // A nested key that stays inside is still allowed.
    await local.put("questions/nested/ok.txt", Buffer.from("fine"));
    check("a legitimate nested key still works",
      fs.existsSync(path.join(process.env.STORAGE_LOCAL_PATH, "questions/nested/ok.txt")));
  }

  console.log("\nvideo providers");
  {
    const providers = video.list();
    check("five providers are offered", providers.length === 5, providers.length);
    check("only bunny and vdocipher are signed",
      providers.filter((p) => p.signed).map((p) => p.name).join() === "bunny,vdocipher");
    check("link and embed providers need no configuration",
      providers.filter((p) => !p.signed).every((p) => p.configured));
  }

  console.log("\nbunny signing");
  {
    process.env.BUNNY_LIBRARY_ID = "9999";
    process.env.BUNNY_SECURITY_KEY = "test-key";

    const media = { kind: "video", driver: "bunny", key: "vid-abc" };
    const first = video.resolve(media);
    check("produces an embed url", first.url.includes("/embed/9999/vid-abc"), first.url);
    check("carries a token", /token=[0-9a-f]{64}/.test(first.url));
    check("carries an expiry", /expires=\d{10}/.test(first.url));
    check("is marked as signed", first.signed === true);

    const withOrigin = video.resolve(media, { origin: "https://school.example.com" });
    check("locks to an origin when given one",
      withOrigin.url.includes("origin=https%3A%2F%2Fschool.example.com"), withOrigin.url);

    // Different expiry means a different token, which is what makes the url
    // expire rather than just look like it does.
    const short = video.get("bunny").embed("vid-abc", { expiresIn: 60 });
    const long = video.get("bunny").embed("vid-abc", { expiresIn: 7200 });
    check("a different expiry changes the token",
      short.url.match(/token=([0-9a-f]+)/)[1] !== long.url.match(/token=([0-9a-f]+)/)[1]);

    delete process.env.BUNNY_LIBRARY_ID;
    delete process.env.BUNNY_SECURITY_KEY;

    const unconfigured = video.resolve(media);
    check("an unconfigured provider reports rather than throws",
      unconfigured.url === null && Boolean(unconfigured.error), JSON.stringify(unconfigured));
  }

  console.log("\nunsigned providers");
  {
    const yt = video.resolve({ kind: "video", driver: "youtube", key: "dQw4w9WgXcQ" });
    check("youtube uses the no-cookie host",
      yt.url.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), yt.url);
    check("youtube is not marked signed", yt.signed === false);

    const vm = video.resolve({ kind: "video", driver: "vimeo", key: "123456789" });
    check("vimeo embeds by id", vm.url === "https://player.vimeo.com/video/123456789", vm.url);

    const direct = video.resolve({ kind: "video", driver: "link", key: "https://cdn.example.com/a.mp4" });
    check("a direct link passes through", direct.url === "https://cdn.example.com/a.mp4");

    check("a non-video returns nothing",
      video.resolve({ kind: "image", driver: "local", key: "x.png" }) === null);
  }

  console.log("\nrejecting bad video input");
  {
    const link = video.get("link");
    check("refuses javascript urls", link.parse("javascript:alert(1)") === null);
    check("refuses plain text", link.parse("not a url") === null);
    check("accepts https", link.parse("https://example.com/a.mp4") !== null);

    check("youtube refuses a wrong-length id", video.get("youtube").parse("abc") === null);
    check("vimeo refuses letters", video.get("vimeo").parse("abcdef") === null);
  }

  fs.rmSync(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((e) => { console.error(e); process.exit(1); });