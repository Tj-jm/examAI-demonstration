const fs = require("fs/promises");
const path = require("path");

// Files on disk, served by express. The default because it needs no account
// anywhere — a buyer can install and upload an image in the same minute.
//
// Fine up to a few thousand files on one server. Beyond that, or behind more
// than one server, the s3 driver is the answer.

const root = () =>
  path.resolve(process.env.STORAGE_LOCAL_PATH || "./uploads");

const safePath = (key) => {
  // A key comes from our own code, but it ends up in a path join, so a
  // traversal attempt is refused rather than trusted.
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep) && full !== root()) {
    throw new Error("Refusing to write outside the uploads directory.");
  }
  return full;
};

const put = async (key, buffer) => {
  const full = safePath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return { key };
};

const get = async (key) => fs.readFile(safePath(key));

const remove = async (key) => {
  try {
    await fs.unlink(safePath(key));
  } catch (error) {
    // Already gone is the desired end state either way.
    if (error.code !== "ENOENT") throw error;
  }
};

// Served by the express static mount in app.js, so a relative path keeps the
// url correct whatever domain the install runs on.
const url = async (key) => `/media/${key}`;

const exists = async (key) => {
  try {
    await fs.access(safePath(key));
    return true;
  } catch {
    return false;
  }
};

module.exports = { put, remove, url, exists, get, pathOf: safePath, name: "local", isPublic: true };
