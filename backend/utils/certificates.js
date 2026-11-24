const crypto = require("crypto");

// Serials: 12 characters from an alphabet without look-alikes (no 0/O, 1/I),
// in three groups — about 60 bits, so one can't be guessed.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makeSerial = () => {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
};

const normaliseSerial = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{4})(.{4})(.{4})$/, "$1-$2-$3");

// {name}, {batch}, {program}, {grade}, {date}. Unknown placeholders stay as
// typed, so a typo shows up on the preview rather than vanishing.
const render = (template, vars) =>
  String(template || "").replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));

// Where /verify lives: the student app's public address. A relative path
// only works when the page asking is on that same origin, which an admin
// panel on its own domain, or the mobile app (https://localhost), is not.
const studentBase = (settings) =>
  String(settings?.seo?.canonicalUrl || process.env.CLIENT_URL_STUDENT || "").trim().replace(/\/+$/, "");
const verifyUrlFor = (serial, settings) => `${studentBase(settings)}/verify/${serial}`;

// A signature picture must be one this app stored (the signature upload),
// never an arbitrary address typed into the request.
const cleanSignatures = (list, resolveOwnMediaKey) =>
  (Array.isArray(list) ? list : [])
    .map((s) => ({
      name: String(s?.name || "").trim().slice(0, 60),
      role: String(s?.role || "").trim().slice(0, 60),
      image: typeof s?.image === "string" && resolveOwnMediaKey(s.image) ? s.image : null,
    }))
    .filter((s) => s.name || s.role || s.image)
    .slice(0, 3);

module.exports = { makeSerial, normaliseSerial, render, studentBase, verifyUrlFor, cleanSignatures };
