const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Guardian contact details: checked and tidied in one place for the import,
// staff edits and the student's own profile.

// Local numbers ("01712…") need a country. The progress-report setting
// wins; otherwise the currency says where the institution is.
const CURRENCY_COUNTRY = { BDT: "BD", INR: "IN", PKR: "PK", NPR: "NP", LKR: "LK", USD: "US", GBP: "GB", AED: "AE", SAR: "SA", MYR: "MY" };
const phoneCountry = (settings) =>
  String(settings?.progressReports?.phoneCountry || "").toUpperCase() || CURRENCY_COUNTRY[settings?.defaultCurrency] || undefined;

const normalisePhone = (raw, country) => {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parsed = parsePhoneNumberFromString(text, country);
  return parsed && parsed.isValid() ? parsed.number : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { guardian } on success, { error } when a value can't be used. Fields left
// undefined keep what `current` has.
const cleanGuardian = (input, current = {}, settings = {}) => {
  const next = {
    name: current.name || "", relation: current.relation || "", phone: current.phone || "",
    email: current.email || "", optOut: Boolean(current.optOut),
  };
  if (!input || typeof input !== "object") return { guardian: next };
  if (input.name !== undefined) next.name = String(input.name || "").trim().slice(0, 80);
  if (input.relation !== undefined) next.relation = String(input.relation || "").trim().slice(0, 40);
  if (input.phone !== undefined) {
    const phone = normalisePhone(input.phone, phoneCountry(settings));
    if (phone === null) {
      const hint = phoneCountry(settings) ? "" : " Add the country code (e.g. +880…), or set the country under Progress reports → Settings.";
      return { error: `"${String(input.phone).trim()}" isn't a valid guardian phone number.${hint}` };
    }
    next.phone = phone;
  }
  if (input.email !== undefined) {
    const email = String(input.email || "").trim().toLowerCase();
    if (email && !EMAIL.test(email)) return { error: `"${email}" isn't a valid guardian email address.` };
    next.email = email;
  }
  if (input.optOut !== undefined) next.optOut = Boolean(input.optOut);
  return { guardian: next };
};

module.exports = { cleanGuardian, normalisePhone, phoneCountry };
