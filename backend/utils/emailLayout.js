// The one look every email has: a header in the theme colour with the logo
// and name, a white card (title, text, optional code / item / button), and a
// footer with contact details and the unsubscribe link. Tables and inline
// styles only, so Gmail, Outlook and Apple Mail all show it the same; a
// colour-scheme hint and a dark block for clients that honour it.
// adapters/email wraps any email that doesn't come through here already.

const { envBaseUrl } = require("./baseUrl");

// Each preset theme's accent (student-app/src/theme/tokens.js, light).
const ACCENT = {
  slate: "#3B5BA5", indigo: "#5B4BC4", emerald: "#0E7C5A", amber: "#A66A0D", rose: "#B03A5E", ocean: "#0F6E7E",
  crimson: "#82171B", coral: "#842F15", olive: "#678131", moss: "#44783A", sky: "#1B557E", violet: "#622277",
  plum: "#813167", sepia: "#7B5737", sand: "#74643E", graphite: "#54575F", gold: "#A69C0D", teal: "#0F7E75",
  cobalt: "#122B91", magenta: "#772270", materialGreen: "#0E7C12", deepPurple: "#774BC4",
};
const HEX = /^#[0-9a-f]{6}$/i;
const MARK = "data-examai-mail";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const colorOf = (settings = {}) => {
  const ui = settings.studentUi || {};
  const custom = ui.theme === "custom" ? ui.customTheme?.light?.accent : null;
  const c = custom || ACCENT[ui.theme] || ACCENT.slate;
  return HEX.test(c) ? c : ACCENT.slate;
};
const logoOf = (settings = {}) => {
  const l = settings.logo?.url || settings.logo || "";
  if (!l || typeof l !== "string") return "";
  if (/^https?:\/\//.test(l)) return l;
  const base = envBaseUrl("SERVER_URL");
  return l.startsWith("/") ? `${base}${l}` : "";
};

// Plain text to paragraphs (blank lines split them; single breaks stay).
const paragraphs = (text) => String(text || "").trim().split(/\n\s*\n/).filter(Boolean)
  .map((p) => `<p class="m-text" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3c4253">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/**
 * render(settings, {
 *   title, kicker, text (plain), html (trusted inner HTML), code,
 *   item: { title, sub, price }, button: { label, url }, note,
 *   reason (why they got it), unsubscribe (url), preheader
 * })
 */
const render = (settings = {}, o = {}) => {
  const c = colorOf(settings);
  const name = settings.siteName || "";
  const logo = logoOf(settings);
  const ri = settings.receiptInfo || {};
  const contact = [ri.address, ri.supportPhone, ri.supportEmail].filter(Boolean).map(esc).join(" · ");
  const font = "Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const head = logo
    ? `<img data-logo="1" src="${esc(logo)}" alt="${esc(name)}" height="36" style="height:36px;max-width:180px;border:0;display:inline-block;vertical-align:middle;border-radius:8px">${name ? `<span style="font-size:17px;font-weight:800;color:#ffffff;vertical-align:middle;margin-left:12px">${esc(name)}</span>` : ""}`
    : `<span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:10px;background:rgba(255,255,255,.2);color:#fff;font-weight:800;vertical-align:middle">${esc((name || "·").slice(0, 1).toUpperCase())}</span><span style="font-size:17px;font-weight:800;color:#ffffff;vertical-align:middle;margin-left:12px">${esc(name)}</span>`;
  const code = o.code ? `<div class="m-code" style="font:800 32px/1 'Courier New',monospace;letter-spacing:8px;text-align:center;background:${c}14;color:${c};border-radius:12px;padding:20px 8px;margin:8px 0 16px">${esc(o.code)}</div>` : "";
  const item = o.item ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e3f0;border-radius:12px;margin:4px 0 20px"><tr>
      <td style="padding:12px 14px"><div class="m-title" style="font-size:15px;font-weight:700;color:#1d2230">${esc(o.item.title)}</div>${o.item.sub ? `<div class="m-muted" style="font-size:13px;color:#6b7083;margin-top:2px">${esc(o.item.sub)}</div>` : ""}</td>
      ${o.item.price ? `<td align="right" class="m-title" style="padding:12px 14px;font-size:16px;font-weight:800;color:#1d2230;white-space:nowrap">${esc(o.item.price)}</td>` : ""}</tr></table>` : "";
  const button = o.button?.url ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td align="center" bgcolor="${c}" style="border-radius:12px">
      <a href="${esc(o.button.url)}" style="display:block;padding:15px 18px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;font-family:${font}">${esc(o.button.label || "Open")}</a></td></tr></table>` : "";
  const footer = [
    contact,
    o.reason ? esc(o.reason) : "",
    o.unsubscribe ? `<a href="${esc(o.unsubscribe)}" style="color:${c}">Unsubscribe from offers and announcements</a>` : "",
  ].filter(Boolean).join("<br>");
  return `<!doctype html><html ${MARK}="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(o.title || name)}</title>
<style>@media (prefers-color-scheme: dark){.m-bg{background:#17181c!important}.m-card{background:#24252b!important}.m-title{color:#f2f3f7!important}.m-text{color:#c6c9d3!important}.m-muted{color:#9da1ad!important}}
@media only screen and (max-width:620px){.m-pad{padding:24px 20px!important}}</style></head>
<body class="m-bg" style="margin:0;padding:0;background:#eef0f5;font-family:${font}">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="m-bg" style="background:#eef0f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td bgcolor="${c}" style="background:${c};border-radius:16px 16px 0 0;padding:18px 28px">${head}</td></tr>
<tr><td class="m-card m-pad" style="background:#ffffff;border-radius:0 0 16px 16px;padding:32px 28px">
${o.kicker ? `<div style="font-size:12px;font-weight:800;letter-spacing:1.5px;color:${c};text-transform:uppercase">${esc(o.kicker)}</div>` : ""}
${o.title ? `<h1 class="m-title" style="margin:6px 0 14px;font-size:24px;line-height:1.25;color:#1d2230;font-weight:800">${esc(o.title)}</h1>` : ""}
${paragraphs(o.text)}${o.html || ""}${code}${item}${button}
${o.note ? `<div class="m-muted" style="font-size:13px;color:#6b7083;text-align:center;margin-top:8px">${esc(o.note)}</div>` : ""}
</td></tr>
${footer ? `<tr><td class="m-muted" align="center" style="padding:20px 12px;font-size:12px;line-height:1.7;color:#7a7f8e">${footer}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
};

const isLaidOut = (html) => typeof html === "string" && html.includes(MARK);

// The logo's own bytes, so it shows without a public link: an uploaded
// logo is stored as "/media/<key>", which means nothing inside an email
// (or to Gmail's image proxy, or on a computer that isn't the server).
// Kept for 10 minutes.
let cache = null;
const logoFile = async (settings = {}) => {
  const l = settings.logo?.url || settings.logo || "";
  if (!l || typeof l !== "string") return null;
  if (cache && cache.src === l && Date.now() - cache.at < 600000) return cache.file;
  let file = null;
  try {
    if (l.startsWith("/media/")) {
      const storage = require("../adapters/storage");
      const key = decodeURIComponent(l.slice(7).split("?")[0]);
      const content = await storage.get(key, "local");
      if (content?.length) file = { content: Buffer.from(content), type: storage.mimeTypeFor ? storage.mimeTypeFor(key) : "image/png" };
    } else if (/^https?:\/\//.test(l)) {
      const r = await fetch(l, { signal: AbortSignal.timeout(5000) });
      const type = r.headers.get("content-type") || "";
      if (r.ok && type.startsWith("image/")) file = { content: Buffer.from(await r.arrayBuffer()), type };
    }
  } catch { file = null; }
  if (file && file.content.length > 400000) file = null;
  if (file && typeof file.type !== "string") file.type = "image/png";
  cache = { src: l, at: Date.now(), file };
  return file;
};
const LOGO_TAG = /(<img data-logo="1" src=")[^"]*(")/;
// For sending: the logo as an inline attachment (cid:), which Gmail shows.
const attachLogo = async (html, settings) => {
  if (!LOGO_TAG.test(html)) return { html, attachments: [] };
  const f = await logoFile(settings);
  if (!f) return { html: html.replace(/<img data-logo="1"[^>]*>/, ""), attachments: [] };
  return { html: html.replace(LOGO_TAG, "$1cid:brand-logo$2"), attachments: [{ filename: "logo", content: f.content, contentType: f.type, cid: "brand-logo" }] };
};
// For the preview in Settings: the logo as a data: address.
const inlineLogo = async (html, settings) => {
  if (!LOGO_TAG.test(html)) return html;
  const f = await logoFile(settings);
  return f ? html.replace(LOGO_TAG, `$1data:${f.type};base64,${f.content.toString("base64")}$2`) : html.replace(/<img data-logo="1"[^>]*>/, "");
};

module.exports = { render, isLaidOut, attachLogo, inlineLogo, colorOf, esc };
