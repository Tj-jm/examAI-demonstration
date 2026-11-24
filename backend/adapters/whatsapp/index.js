// WhatsApp messages through Meta's WhatsApp Cloud API, the school's own
// WhatsApp Business number. A message a school starts (not a reply) must use
// a template Meta has approved, so two are needed:
//   WHATSAPP_TEMPLATE      a Utility template whose body is one variable,
//                          {{1}}, filled with the whole message;
//   WHATSAPP_OTP_TEMPLATE  an Authentication template (with Meta's "copy
//                          code" button) for sign-up and login codes.
// Without the code template, codes go out through the general one.
// MESSAGE_CHANNEL (../sms) decides when WhatsApp is used instead of SMS.

const API = "https://graph.facebook.com/v21.0";

const configured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_TEMPLATE);

// Meta wants the number as digits with the country code, no "+".
const number = (to) => String(to || "").replace(/[^\d]/g, "");

// A template variable can't hold new lines, tabs or more than four spaces
// in a row, and stops at 1,024 characters.
const flat = (text) => String(text || "").replace(/\s*\n+\s*/g, " · ").replace(/\s{2,}/g, " ").trim().slice(0, 1024);

const post = async (body) => {
  const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`WhatsApp rejected the message: ${data?.error?.message || `HTTP ${res.status}`}`);
  }
};

const template = (to, name, components) => post({
  to: number(to),
  type: "template",
  template: { name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components },
});

const send = async (to, message, { code } = {}) => {
  if (!configured()) throw new Error("WhatsApp is not set up: the access token, phone number ID or message template is missing.");
  if (code && process.env.WHATSAPP_OTP_TEMPLATE) {
    return template(to, process.env.WHATSAPP_OTP_TEMPLATE, [
      { type: "body", parameters: [{ type: "text", text: String(code) }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(code) }] },
    ]);
  }
  return template(to, process.env.WHATSAPP_TEMPLATE, [{ type: "body", parameters: [{ type: "text", text: flat(message) }] }]);
};

// Settings → Keys: the token can read the phone number it's meant to send from.
const check = async () => {
  if (!configured()) return { ok: false, message: "Fill in the access token, phone number ID and message template." };
  const res = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  }).catch((error) => ({ ok: false, json: async () => ({ error: { message: error.message } }) }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: `WhatsApp said: ${data?.error?.message || "the token or phone number ID is wrong."}` };
  return { ok: true, message: `Connected: ${data.verified_name || "your business"} (${data.display_phone_number}). The templates are checked when a message is sent.` };
};

module.exports = { configured, send, check };
