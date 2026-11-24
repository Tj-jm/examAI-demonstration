const dns = require("dns");
const net = require("net");
const https = require("https");

// Calls to an address a student typed (their own AI server: Settings → AI
// models → Students' own keys → custom link). Such a call is made by this
// server, so it must never reach anything only this server can reach:
// localhost, the private network, the cloud's metadata address.
//
//   - https only, port 443, no user:password in the address
//   - every address the name resolves to must be public, checked when the
//     connection is made (so a name can't switch to 127.0.0.1 after it
//     passed the check)
//   - redirects are not followed; replies are capped in size and time
//   - optionally only hosts on the admin's list

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 120000;

const v4 = (ip) => ip.split(".").map(Number);
const privateV4 = (ip) => {
  const [a, b] = v4(ip);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
};
const isPrivate = (ip) => {
  if (net.isIPv4(ip)) return privateV4(ip);
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9")
    || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff") || x.startsWith("64:ff9b") || x.startsWith("2001:db8");
};

const hostAllowed = (host, allowed) =>
  !allowed?.length || allowed.some((d) => {
    const dom = String(d).toLowerCase().replace(/^\*\./, "").trim();
    return dom && (host === dom || host.endsWith(`.${dom}`));
  });

const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });

// Throws (400) unless url is acceptable. → the cleaned base URL.
const check = async (raw, allowed = []) => {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw bad("That isn't a valid address. It should look like https://example.com/v1.");
  }
  if (u.protocol !== "https:") throw bad("The address must start with https://.");
  if (u.username || u.password) throw bad("Leave the user name and password out of the address.");
  if (u.port && u.port !== "443") throw bad("Only the standard https port is allowed.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) throw bad("Use the server's name, not an IP address.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw bad("That address isn't on the public internet.");
  }
  if (!hostAllowed(host, allowed)) throw bad(`Your school allows only these: ${allowed.join(", ")}.`);
  const found = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (!found.length) throw bad("That address can't be found.");
  if (found.some((a) => isPrivate(a.address))) throw bad("That address isn't on the public internet.");
  return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
};

// The DNS lookup used when connecting: refuses private answers.
const guardedLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => isPrivate(a.address))) {
      return callback(Object.assign(new Error("That address isn't on the public internet."), { code: "EBLOCKED" }));
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

// A fetch() stand-in for one untrusted address: same call shape the AI
// providers use ({ ok, status, text() }).
const safeFetch = (url, { method = "GET", headers = {}, body, signal } = {}) =>
  new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(bad("Invalid address."));
    }
    if (u.protocol !== "https:" || (u.port && u.port !== "443") || net.isIP(u.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(bad("That address isn't allowed."));
    }
    const req = https.request(u, { method, headers, lookup: guardedLookup, timeout: TIMEOUT_MS, signal }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(new Error("The server tried to redirect; redirects aren't followed. Use the final address."));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error("The reply was too large."));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => text });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The server took too long to answer.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

module.exports = { check, safeFetch, isPrivate, hostAllowed };
