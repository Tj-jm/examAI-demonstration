// Student photos (answers, doubts, course chat) as the AI should see them.
//
// preparePhoto runs on upload: turns the photo upright from the camera's
// orientation tag, shrinks a 12-megapixel phone photo to a size vision
// models read well, and drops the metadata (location included). A photo
// that can't be read is stored as it came.
//
// stitchImages runs when an answer has several photos: they go to the
// model as one tall page, top to bottom in the order they were added,
// since providers take one image per call.

const MAX_SIDE = 2000;
const RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

const sharp = () => require("sharp");

const preparePhoto = async (file) => {
  if (!file?.buffer || !RASTER.has(file.mimetype)) return file;
  try {
    let img = sharp()(file.buffer, { failOn: "none", limitInputPixels: 50e6 }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
    img = file.mimetype === "image/png" ? img.png() : file.mimetype === "image/webp" ? img.webp({ quality: 85 }) : img.jpeg({ quality: 85, mozjpeg: true });
    const buffer = await img.toBuffer();
    return { ...file, buffer, size: buffer.length };
  } catch {
    // Not a readable image: refuse it rather than store what was sent.
    // Re-encoding above is also what strips anything hidden inside a real
    // one (metadata, appended data, location).
    throw Object.assign(new Error("That image couldn't be read. Try another photo."), { statusCode: 415 });
  }
};

const PAGE_WIDTH = 1400;
const GAP = 24;
const MAX_HEIGHT = 7000;

// images: [{ base64, mimeType }] -> one { base64, mimeType }.
const stitchImages = async (images) => {
  if (images.length <= 1) return images[0] || null;
  const s = sharp();
  const pages = [];
  for (const im of images) {
    const { data, info } = await s(Buffer.from(im.base64, "base64"), { failOn: "none", limitInputPixels: 50e6 })
      .rotate()
      .resize({ width: PAGE_WIDTH, height: PAGE_WIDTH * 2, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    pages.push({ data, width: info.width, height: info.height });
  }
  const width = Math.max(...pages.map((p) => p.width));
  const height = pages.reduce((h, p) => h + p.height, 0) + GAP * (pages.length - 1);
  let top = 0;
  const composite = pages.map((p) => {
    const at = { input: p.data, top, left: 0 };
    top += p.height + GAP;
    return at;
  });
  // A grey bar between photos marks where one ends and the next begins.
  let out = s({ create: { width, height, channels: 3, background: "#9aa0a6" } }).composite(composite).jpeg({ quality: 85 });
  if (height > MAX_HEIGHT) out = s(await out.toBuffer()).resize({ height: MAX_HEIGHT, fit: "inside" }).jpeg({ quality: 85 });
  const buffer = await out.toBuffer();
  return { base64: buffer.toString("base64"), mimeType: "image/jpeg" };
};

// Whether a photo carries a camera's EXIF (a camera make, or the time it
// was taken). Photos straight from a phone camera do; screenshots, snips
// and most saved web images don't. Read before preparePhoto strips it.
// A hint only, not proof: a book page photographed with a camera has it.
const CAMERA_TAGS = [
  Buffer.from([0x0f, 0x01, 0x02, 0x00]), Buffer.from([0x01, 0x0f, 0x00, 0x02]), // Make
  Buffer.from([0x03, 0x90, 0x02, 0x00]), Buffer.from([0x90, 0x03, 0x00, 0x02]), // DateTimeOriginal
];
const hasCameraData = async (file) => {
  if (!file?.buffer || !RASTER.has(file.mimetype)) return false;
  try {
    const { exif } = await sharp()(file.buffer, { failOn: "none", limitInputPixels: 50e6 }).metadata();
    return Boolean(exif) && CAMERA_TAGS.some((tag) => exif.includes(tag));
  } catch {
    return false;
  }
};

module.exports = { preparePhoto, stitchImages, hasCameraData };
