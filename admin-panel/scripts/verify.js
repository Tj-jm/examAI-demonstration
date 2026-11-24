// Three checks the bundler cannot make. Each one catches a class of failure
// that builds cleanly and then breaks at runtime with a blank screen.
//
//   1. a page imports a hook the api slice never exported
//   2. a link points at a route that was never declared
//   3. a query calls an api path the backend does not serve
//
// Run with `npm run verify`.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");

let failed = 0;
const fail = (title, items) => {
  failed += 1;
  console.log(`  FAIL  ${title}`);
  items.forEach((i) => console.log(`        ${i}`));
};
const pass = (title) => console.log(`  ok    ${title}`);

const jsxFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (p.endsWith(".jsx")) jsxFiles.push(p);
  }
})(src);

// ---------------------------------------------------------------- 1. hooks
{
  const exported = new Set();
  for (const file of fs.readdirSync(path.join(src, "api"))) {
    const text = fs.readFileSync(path.join(src, "api", file), "utf8");
    const block = text.match(/export const \{([\s\S]*?)\} =/);
    if (block) {
      block[1].split(",").map((s) => s.trim()).filter(Boolean).forEach((h) => exported.add(h));
    }
  }

  const missing = [];
  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/import \{([^}]+)\} from "\.\.\/api\/\w+"/g)) {
      for (const hook of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        if (!exported.has(hook)) missing.push(`${hook} in ${path.basename(file)}`);
      }
    }
  }

  missing.length
    ? fail("every imported hook is exported", missing)
    : pass(`every imported hook is exported (${exported.size} available)`);
}

// ---------------------------------------------------------------- 2. routes
{
  const app = fs.readFileSync(path.join(src, "App.jsx"), "utf8");
  const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
  routes.push("/");

  const patterns = routes.map(
    (r) => new RegExp(`^/?${r.replace(/:[a-zA-Z]+/g, "[^/]+").replace(/^\//, "")}/?$`)
  );

  const broken = [];
  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    const links = [
      ...[...text.matchAll(/to=\{?[`"]([^`"]+)[`"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/navigate\([`"]([^`"]+)[`"]/g)].map((m) => m[1]),
    ];
    for (const link of links) {
      const clean = link.split("?")[0].replace(/\$\{[^}]+\}/g, "x");
      if (!patterns.some((p) => p.test(clean))) broken.push(`${link} in ${path.basename(file)}`);
    }
  }

  broken.length
    ? fail("every link resolves to a route", broken)
    : pass(`every link resolves to a route (${routes.length} declared)`);
}

// ---------------------------------------------------------------- 3. api
{
  let audit;
  try {
    audit = execSync("node tests/routeAudit.js", {
      cwd: path.join(root, "..", "backend"),
      encoding: "utf8",
    });
  } catch {
    console.log("  skip  backend route check (could not run the audit)");
    audit = null;
  }

  if (audit) {
    const live = new Set();
    for (const line of audit.split("\n")) {
      const m = line.match(/^(GET|POST|PUT|DELETE) (\/api\/\S+)/);
      if (m) live.add(`${m[1]} ${m[2].replace(/:[a-zA-Z]+/g, ":x").replace(/\/$/, "")}`);
    }

    const calls = [];
    for (const file of fs.readdirSync(path.join(src, "api"))) {
      const text = fs.readFileSync(path.join(src, "api", file), "utf8");
      // One-line endpoints end on their own line; multi-line ones at "\n    }),".
      for (const m of text.matchAll(/(\w+): builder\.(query|mutation)\(\{(?:([^\n]*)\}\),$|([\s\S]*?)\n    \}\),)/gm)) {
        const body = m[3] ?? m[4];
        const url = body.match(/url: [`"]([^`"]+)[`"]/) || body.match(/=> [`"]([^`"]+)[`"]/);
        const method = body.match(/method: "(\w+)"/);
        if (url) calls.push({ name: m[1], call: `${method ? method[1] : "GET"} /api${url[1]}` });
      }
    }

    const normalise = (s) =>
      s.replace(/\$\{qs\([^)]*\)\}/g, "").replace(/\$\{[^}]+\}/g, ":x").split("?")[0].replace(/\/$/, "");

    // A templated segment (":x") on the client can stand for a route
    // parameter or a literal segment, e.g. `/saved/${id}/${action}`.
    const matches = (call) => {
      if (live.has(call)) return true;
      const pattern = new RegExp(`^${call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:x/g, "[^/]+")}$`);
      return [...live].some((route) => pattern.test(route));
    };
    const orphans = calls.filter((c) => !matches(normalise(c.call)));

    orphans.length
      ? fail("every api call matches a backend route", orphans.map((o) => `${o.name}: ${o.call}`))
      : pass(`every api call matches a backend route (${calls.length} calls)`);
  }
}

// ---------------------------------------------------------- 4. destructive
{
  // Every delete must go through the confirm dialog. window.confirm is
  // unstyled and unthemeable, and a delete with no confirmation at all is how
  // a teacher loses an afternoon of work to a mis-tap.
  const stray = [];
  const unconfirmed = [];

  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    const name = path.basename(file);

    // Comments are stripped first: this file's own explanation of why
    // window.confirm is not used would otherwise trip the check.
    const code = text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/window\.confirm/.test(code)) stray.push(`${name} uses window.confirm`);

    // A page that fires a delete mutation must also pull in useConfirm.
    const deletes = [...text.matchAll(/use(Delete|Revoke)\w*Mutation/g)].map((m) => m[0]);
    if (deletes.length > 0 && !/useConfirm/.test(text)) {
      unconfirmed.push(`${name} calls ${deletes.join(", ")} without useConfirm`);
    }
  }

  const problems = [...stray, ...unconfirmed];
  problems.length
    ? fail("every delete is confirmed", problems)
    : pass("every delete is confirmed");
}

// ---------------------------------------------------------------- 5. icons
{
  // Unicode glyphs render differently on every platform and read as
  // placeholder art. They were the first pass; nothing should still use them.
  const GLYPHS = ["◍", "◫", "▤", "☰", "▷", "◎", "◇", "✦", "◆", "◈", "⏻", "✕", "↑", "↓", "▾", "▸"];
  const found = [];

  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const glyph of GLYPHS) {
      if (text.includes(glyph)) found.push(`${path.basename(file)} still uses ${glyph}`);
    }
  }

  found.length
    ? fail("no placeholder glyphs remain", found)
    : pass("no placeholder glyphs remain");
}

// ------------------------------------------------------- 6. maths rendering
{
  // Questions are authored with LaTeX between dollar signs. Any screen that
  // prints question text raw shows a teacher "$v = \\frac{s}{t}$" instead of a
  // fraction, which makes it impossible to check what a student will see.
  const raw = [];

  const FIELDS = [
    "question.question",
    "question.solutionText",
    "option.text",
    "statement.text",
    "row.criterion",
  ];

  for (const file of jsxFiles) {
    const name = path.basename(file);
    if (name === "Latex.jsx") continue;

    const text = fs.readFileSync(file, "utf8");

    for (const field of FIELDS) {
      const escaped = field.replace(".", "\\.");

      // Only children position counts. An input's `value={option.text}` is
      // correct as raw text — a teacher edits the LaTeX source, not a rendered
      // fraction — so an attribute binding is not a finding.
      const inChildren = new RegExp(`>\\s*\\{\\s*${escaped}\\s*\\}|\\{\\s*${escaped}\\s*\\}\\s*<`);

      if (!inChildren.test(text)) continue;

      // Present but not wrapped anywhere in the file.
      const wrapped = new RegExp(`<Latex[^>]*>\\s*\\{\\s*${escaped}\\s*\\}`);
      if (!wrapped.test(text)) {
        raw.push(`${name} prints ${field} without <Latex>`);
      }
    }
  }

  raw.length
    ? fail("question text is rendered through <Latex>", raw)
    : pass("question text is rendered through <Latex>");
}

// ------------------------------------------------------ 7. clearable fields
{
  // `field: value || undefined` in a save payload means an emptied box is
  // never sent, the server skips the missing key, and the old value stays.
  // The delete appears to do nothing and reports no error.
  //
  // Query parameters are the opposite case: there, dropping an empty filter is
  // exactly right, so only mutation payloads are checked.
  const offenders = [];

  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    const name = path.basename(file);

    // The payload object a save builds, between `const payload = {` and its
    // closing brace at the same indent.
    const block = text.match(/const payload = \{[\s\S]*?\n {4}\};/);
    if (!block) continue;

    for (const m of block[0].matchAll(/(\w+):\s*[^,\n]*\|\|\s*undefined/g)) {
      offenders.push(`${name} sends ${m[1]} as undefined when empty, so it cannot be cleared`);
    }
  }

  offenders.length
    ? fail("emptied fields are sent, not dropped", offenders)
    : pass("emptied fields are sent, not dropped");
}

// -------------------------------------------------------- 8. shadowed globals
{
  // A component named `Math` shadows the JavaScript global in every file that
  // imports it, so Math.min throws and the page renders white. The error names
  // the line but not the cause, which makes it expensive to find.
  const GLOBALS = [
    "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "JSON",
    "Promise", "Map", "Set", "Error", "RegExp", "Symbol", "Function", "Intl",
  ];

  const clashes = [];

  for (const file of jsxFiles) {
    const text = fs.readFileSync(file, "utf8");
    const name = path.basename(file);

    for (const g of GLOBALS) {
      if (new RegExp(`export default function ${g}\\b`).test(text)) {
        clashes.push(`${name} exports a component named ${g}, shadowing the global`);
      }
      if (new RegExp(`import ${g} from`).test(text)) {
        clashes.push(`${name} imports something as ${g}, shadowing the global`);
      }
    }
  }

  clashes.length
    ? fail("nothing is named after a javascript global", clashes)
    : pass("nothing is named after a javascript global");
}

// ------------------------------------------------------- 9. proxied paths
{
  // Anything the backend serves must be proxied in development, or it works in
  // production and 404s on the developer's machine. Uploaded images sat behind
  // /media for a week before anyone noticed the picture never appeared.
  const config = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
  const proxied = [...config.matchAll(/"(\/[a-z]+)":\s*\{/g)].map((m) => m[1]);

  const SERVED_BY_BACKEND = ["/api", "/media"];
  const missing = SERVED_BY_BACKEND.filter((p) => !proxied.includes(p));

  missing.length
    ? fail("every backend path is proxied in development",
        missing.map((p) => `${p} is served by the backend but vite does not forward it`))
    : pass(`every backend path is proxied in development (${proxied.join(", ")})`);
}

console.log("");
if (failed > 0) {
  console.error(`${failed} check(s) failed.`);
  process.exit(1);
}
console.log("PASS");
