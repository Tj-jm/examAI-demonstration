// utils/mediaUrl.js: recovering a storage key from the url the app issued,
// whatever shape the storage provider gives that url.
const { resolveOwnMediaKey } = require("../utils/mediaUrl");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

const key = "answer-images/0123456789abcdef0123456789abcdef.jpg";
check("local /media path", resolveOwnMediaKey(`/media/${key}`) === key);
check("AWS presigned, virtual-hosted", resolveOwnMediaKey(`https://b.s3.amazonaws.com/${key}?X-Amz-Signature=x`) === key);
check("R2 presigned, path-style with the bucket in the path", resolveOwnMediaKey(`https://acct.r2.cloudflarestorage.com/bucket/${key}?X-Amz-Signature=x`) === key);
check("endpoint with its own path (Supabase /storage/v1/s3)", resolveOwnMediaKey(`https://p.supabase.co/storage/v1/s3/bucket/${key}?X-Amz-Signature=x`) === key);
check("public CDN base", resolveOwnMediaKey(`https://pub-1.r2.dev/${key}`) === key);
check("a url that isn't one of ours is refused", resolveOwnMediaKey("http://169.254.169.254/latest/meta-data/") === null && resolveOwnMediaKey("https://evil.example/a/b.jpg") === null);

console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
