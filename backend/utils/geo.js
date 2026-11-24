const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

// Where a visit came from on the map, for the Visitors page (utils/visitors.js).
// Only country, region and city are kept; the IP address is never stored.
//
// 1. Behind Cloudflare with "Add visitor location headers" on, its
//    cf-ipcountry / cf-region / cf-ipcity headers are used as they are.
// 2. Otherwise, once switched on (admin → Visitors), the free DB-IP
//    "IP to City Lite" database (CC BY 4.0, monthly) is downloaded to
//    geo-data/ and looked up here. It takes about 130 MB of memory.

const DIR = process.env.GEO_DATA_DIR || path.join(__dirname, "../geo-data");
const FILE = path.join(DIR, "dbip-city-lite.mmdb");
const REFRESH_DAYS = 35;

let reader = null;
let loading = null;
let downloading = null;
let lastError = "";

const fileAge = () => {
  try {
    return (Date.now() - fs.statSync(FILE).mtimeMs) / 86400000;
  } catch {
    return Infinity;
  }
};

const monthOf = (offset) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// This month's file, or last month's while this month's isn't out yet.
const download = () => {
  if (downloading) return downloading;
  downloading = (async () => {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.part`;
    let lastStatus = 0;
    for (const offset of [0, 1]) {
      const res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${monthOf(offset)}.mmdb.gz`);
      lastStatus = res.status;
      if (!res.ok || !res.body) continue;
      await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), fs.createWriteStream(tmp));
      fs.renameSync(tmp, FILE);
      reader = null;
      lastError = "";
      return true;
    }
    throw new Error(`Location database download failed (HTTP ${lastStatus}).`);
  })()
    .catch((err) => {
      lastError = err.message;
      return false;
    })
    .finally(() => {
      downloading = null;
    });
  return downloading;
};

const open = () => {
  if (reader || loading) return;
  if (fileAge() === Infinity) {
    download();
    return;
  }
  if (fileAge() > REFRESH_DAYS) download();
  loading = require("maxmind")
    .open(FILE)
    .then((r) => {
      reader = r;
    })
    .catch((err) => {
      lastError = err.message;
    })
    .finally(() => {
      loading = null;
    });
};

const header = (req, name) => {
  const v = String(req.get(name) || "").trim();
  if (!v) return "";
  try {
    return decodeURIComponent(v).slice(0, 60);
  } catch {
    return v.slice(0, 60);
  }
};

// { country, region, city } or null. country is an ISO code ("BD").
const locate = (req, lookupOn) => {
  const cf = header(req, "cf-ipcountry").toUpperCase();
  if (cf && !["XX", "T1"].includes(cf)) {
    return { country: cf.slice(0, 2), region: header(req, "cf-region"), city: header(req, "cf-ipcity") };
  }
  if (!lookupOn) return null;
  if (!reader) {
    open();
    return null;
  }
  if (fileAge() > REFRESH_DAYS) download();
  try {
    const hit = reader.get(req.ip);
    if (!hit?.country?.iso_code) return null;
    return {
      country: hit.country.iso_code,
      region: hit.subdivisions?.[0]?.names?.en || "",
      city: hit.city?.names?.en || "",
    };
  } catch {
    return null;
  }
};

const status = () => ({
  ready: Boolean(reader) || fileAge() !== Infinity,
  downloading: Boolean(downloading),
  updatedAt: fileAge() === Infinity ? null : new Date(fs.statSync(FILE).mtimeMs),
  error: lastError,
});

module.exports = { locate, download, status };
