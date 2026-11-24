// Phone-based OTP delivery only. Email OTP is a separate, always-available
// path once SMTP is configured (see ../email) — a student can register with
// either identifier, and this adapter only ever needs to exist for the phone
// one. SMS_PROVIDER picks which gateway actually sends it; leaving it unset
// simply means phone signup is not offered yet, the same way an unconfigured
// Bunny key means that video option is not offered yet.

const twilio = {
  name: "twilio",
  label: "Twilio",
  needs: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],

  configured() {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    );
  },

  async send(to, message) {
    if (!this.configured()) {
      throw new Error("Twilio is selected but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_FROM_NUMBER is missing.");
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: message }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Twilio rejected the message (HTTP ${res.status}): ${detail.slice(0, 200)}`);
    }
  },
};

const vonage = {
  name: "vonage",
  label: "Vonage",
  needs: ["VONAGE_API_KEY", "VONAGE_API_SECRET"],

  configured() {
    return Boolean(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET);
  },

  async send(to, message) {
    if (!this.configured()) {
      throw new Error("Vonage is selected but VONAGE_API_KEY or VONAGE_API_SECRET is missing.");
    }

    const res = await fetch("https://rest.nexmo.com/sms/json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_key: process.env.VONAGE_API_KEY,
        api_secret: process.env.VONAGE_API_SECRET,
        to,
        from: process.env.VONAGE_FROM || "ExamAI",
        text: message,
      }),
    });

    const data = await res.json().catch(() => ({}));
    const status = data?.messages?.[0]?.status;

    if (status !== "0") {
      throw new Error(`Vonage rejected the message: ${data?.messages?.[0]?.["error-text"] || `status ${status || "unknown"}`}`);
    }
  },
};

// sms.net.bd — a Bangladeshi bulk-SMS gateway. Query-param GET/POST, not the
// generic http driver's JSON {to,message} shape, and it reports success as
// error:0 in the JSON body rather than an HTTP status, so it needs its own
// driver rather than fitting through `http` below.
const smsnetbd = {
  name: "smsnetbd",
  label: "SMS.net.bd",
  needs: ["SMS_API_KEY"],

  configured() {
    return Boolean(process.env.SMS_API_KEY);
  },

  async send(to, message) {
    if (!this.configured()) {
      throw new Error("SMS.net.bd is selected but SMS_API_KEY is missing.");
    }

    // The gateway is Bangladesh-only and expects the number without a `+`,
    // prefixed with the country code — a bare 11-digit local number
    // ("017...") gets "88" prepended; a number already carrying it
    // ("8801...") or a "+8801..." is left as the digits are.
    const digits = String(to).replace(/[^\d]/g, "");
    const normalised = digits.startsWith("88") ? digits : `88${digits}`;

    const url = process.env.SMS_API_URL || "https://api.sms.net.bd/sendsms";
    const params = new URLSearchParams({
      api_key: process.env.SMS_API_KEY,
      msg: message,
      to: normalised,
      method: "api",
    });

    let data;
    try {
      const res = await fetch(`${url}?${params.toString()}`, { method: "POST" });
      data = await res.json().catch(() => ({}));
    } catch (error) {
      throw new Error(`Could not reach SMS.net.bd: ${error.message}`);
    }

    if (data?.error !== 0) {
      throw new Error(`SMS.net.bd rejected the message: ${JSON.stringify(data)}`);
    }
  },
};

// A generic driver for any gateway not listed by name — most regional SMS
// APIs (a local carrier gateway, MessageBird, AWS SNS behind a small proxy,
// an in-house sender) accept a simple "POST this JSON" shape. This template
// lets one install point at whatever that shape happens to be without a new
// driver file, at the cost of the gateway needing to accept {to, message}.
const http = {
  name: "http",
  label: "Custom HTTP gateway",
  needs: ["SMS_HTTP_URL"],

  configured() {
    return Boolean(process.env.SMS_HTTP_URL);
  },

  async send(to, message) {
    if (!this.configured()) {
      throw new Error("A custom SMS gateway is selected but SMS_HTTP_URL is missing.");
    }

    const headers = { "Content-Type": "application/json" };
    if (process.env.SMS_HTTP_AUTH_HEADER) headers.Authorization = process.env.SMS_HTTP_AUTH_HEADER;

    const res = await fetch(process.env.SMS_HTTP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, message }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`The SMS gateway returned HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
  },
};

const PROVIDERS = { twilio, vonage, smsnetbd, http };

const getDriver = () => {
  const name = process.env.SMS_PROVIDER;
  if (!name) return null;

  const driver = PROVIDERS[name];
  if (!driver) {
    throw new Error(`Unknown SMS_PROVIDER "${name}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  }
  return driver;
};

const smsReady = () => {
  const driver = getDriver();
  return Boolean(driver && driver.configured());
};

// MESSAGE_CHANNEL: how phone messages go out once WhatsApp is set up
// (../whatsapp). sms (default), whatsapp, whatsapp_sms (WhatsApp, and SMS
// when that fails) or both.
const whatsapp = require("../whatsapp");
const channel = () => (whatsapp.configured() ? process.env.MESSAGE_CHANNEL || "sms" : "sms");

const configured = () => smsReady() || (channel() !== "sms" && whatsapp.configured());
// Sign-up codes may go by WhatsApp, so the sign-up form asks for consent.
const whatsappCodes = () => channel() !== "sms";

const sendSms = async (to, message) => {
  const driver = getDriver();
  if (!driver) {
    throw new Error("No SMS provider is configured. Set SMS_PROVIDER in the environment.");
  }
  await driver.send(to, message);
};

// options.code: the sign-up or login code in `message`, for WhatsApp's
// code template. options.optIn false: the student didn't agree to WhatsApp,
// so SMS when there is a gateway.
const send = async (to, message, options = {}) => {
  const how = options.optIn === false && smsReady() ? "sms" : channel();
  if (how === "sms") return sendSms(to, message);
  if (how === "both") {
    const results = await Promise.allSettled([whatsapp.send(to, message, options), ...(smsReady() ? [sendSms(to, message)] : [])]);
    if (results.every((r) => r.status === "rejected")) throw results[0].reason;
    return undefined;
  }
  try {
    return await whatsapp.send(to, message, options);
  } catch (error) {
    if (how === "whatsapp_sms" && smsReady()) return sendSms(to, message);
    throw error;
  }
};

// For an admin settings screen: which channel is selected, and is it
// actually usable, the same shape adapters/video's list() already returns.
const list = () => {
  const active = process.env.SMS_PROVIDER || null;
  return Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    label: p.label,
    active: p.name === active,
    configured: p.configured(),
    needs: p.needs,
  }));
};

module.exports = { send, configured, smsReady, whatsappCodes, list, PROVIDERS };
