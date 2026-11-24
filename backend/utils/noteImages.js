// Pictures in lecture notes must be links that never expire and work from
// any app (utils: routes/streamRoutes.js /api/stream/file). Text copied from
// "Read pages" used to carry the admin panel's own address (/media/… made
// absolute) or a cloud storage link signed for an hour: fine for the admin
// who pasted it, broken for students later or in the mobile app. This turns
// any such link to one of our stored pictures into the permanent form.

const STORED = /\/(lectures|questions)\/([a-f0-9]{32}\.(?:png|jpe?g|webp|gif))(?:[?#].*)?$/i;

const ours = (url) => {
  if (url.startsWith("/api/stream/file/")) return false;
  if (url.startsWith("/media/") || /\/media\/(lectures|questions)\//.test(url)) return true;
  // A cloud storage link: signed, or under the bucket's public address.
  if (/[?&]X-Amz-Signature=/.test(url)) return true;
  const base = process.env.S3_PUBLIC_BASE_URL || process.env.STORAGE_PUBLIC_BASE_URL;
  return Boolean(base && url.startsWith(base.replace(/\/$/, "")));
};

const stableLink = (url) => {
  if (!ours(url)) return url;
  const m = url.match(STORED);
  return m ? `/api/stream/file/${m[1].toLowerCase()}/${m[2]}` : url;
};

const stableImages = (markdown) => (typeof markdown === "string"
  ? markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (all, head, url) => `${head}${stableLink(url)}`)
  : markdown);

// Lectures saved before this: fixed once, in the background, at start.
const fixSavedLectures = async () => {
  const Lecture = require("../models/lectureModel");
  const lectures = await Lecture.find({ bodyMarkdown: { $ne: null } }).select("bodyMarkdown").lean();
  let fixed = 0;
  for (const l of lectures) {
    const body = stableImages(l.bodyMarkdown);
    if (body !== l.bodyMarkdown) {
      await Lecture.updateOne({ _id: l._id }, { $set: { bodyMarkdown: body } });
      fixed += 1;
    }
  }
  return fixed;
};

module.exports = { stableImages, stableLink, fixSavedLectures };
