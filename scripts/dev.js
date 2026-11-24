#!/usr/bin/env node
// `npm run dev`: backend, admin panel and student app together.
//
// Each server is started with node directly, not through `npm run`: on
// Windows npm runs scripts through a .cmd batch file, so Ctrl+C asked
// "Terminate batch job (Y/N)?" once per server and the terminal hung.

const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const run = (dir, script, args = "") => `node "${path.join(root, dir, "node_modules", script)}" ${args}`.trim();

const servers = [
  ["backend", "blue", "backend", run("backend", "nodemon/bin/nodemon.js", "server.js")],
  ["admin", "magenta", "admin-panel", run("admin-panel", "vite/bin/vite.js")],
  ["student", "green", "student-app", run("student-app", "vite/bin/vite.js")],
];

const concurrently = path.join(path.dirname(require.resolve("concurrently/package.json", { paths: [root] })), "dist", "bin", "concurrently.js");
const child = spawn(process.execPath, [
  concurrently, "-k",
  "-n", servers.map((s) => s[0]).join(","),
  "-c", servers.map((s) => s[1]).join(","),
  // Each command runs in its own folder, as `npm run dev --prefix` did.
  ...servers.map(([, , dir, cmd]) => `cd "${path.join(root, dir)}" && ${cmd}`),
], { stdio: "inherit", env: process.env });

// Ctrl+C reaches every process in the terminal at once; just wait for them.
process.on("SIGINT", () => {});
child.on("exit", (code) => process.exit(code ?? 0));
