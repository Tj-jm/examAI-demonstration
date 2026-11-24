// The admin panel's icon picker (ICON_PRESETS) and the student app's icon
// map (COMPONENTS) are separate lists in separate apps. An icon the admin
// can pick but the student app can't draw silently shows as the default
// graduation cap for students — this fails the run instead.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const names = (block) => block.replace(/\/\/.*$/gm, "").split(/[\s,"]+/).filter(Boolean);

const admin = read("admin-panel/src/components/BatchIcon.jsx");
const student = read("student-app/src/components/BatchIcon.jsx");

const presets = names(admin.match(/ICON_PRESETS = \[([\s\S]*?)\];/)[1]);
const adminMap = names(admin.match(/const COMPONENTS = \{([\s\S]*?)\};/)[1]);
const studentMap = names(student.match(/COMPONENTS = \{([\s\S]*?)\};/)[1]);
const studentImports = names(student.match(/import \{([\s\S]*?)\} from "lucide-react"/)[1]);

let failed = 0;
const check = (label, missing) => {
  if (missing.length === 0) console.log(`  ok    ${label}`);
  else { failed += 1; console.log(`  FAIL  ${label} — missing: ${missing.join(", ")}`); }
};

console.log("\nicon presets");
check(`admin can draw every icon it offers (${presets.length})`, presets.filter((n) => !adminMap.includes(n)));
check("student app can draw every icon admin offers", presets.filter((n) => !studentMap.includes(n)));
check("student app imports every icon in its map", studentMap.filter((n) => !studentImports.includes(n)));

if (failed > 0) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
