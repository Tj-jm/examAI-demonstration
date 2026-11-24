const { getCountries, getCountryCallingCode } = require("libphonenumber-js");

// Every country a phone number can be dialled from: ISO code, calling code
// and English name, A to Z. Admins pick from this which ones students may
// sign up and log in with (Settings → Student app → Sign-up).
let names = null;
try {
  names = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  // A Node without full ICU: codes stand in for names.
}

const ALL = getCountries()
  .map((code) => ({ code, dial: getCountryCallingCode(code), name: names?.of(code) || code }))
  .sort((a, b) => a.name.localeCompare(b.name));
const BY_CODE = new Map(ALL.map((c) => [c.code, c]));

const valid = (codes) => [...new Set((codes || []).map((c) => String(c).toUpperCase()))].filter((c) => BY_CODE.has(c));

// The countries offered to students, the default one first.
const offered = (auth) => {
  const codes = valid(auth?.countries);
  const list = (codes.length ? codes : ["BD"]).map((c) => BY_CODE.get(c));
  const first = valid([auth?.defaultCountry])[0];
  return first && list.some((c) => c.code === first) ? [BY_CODE.get(first), ...list.filter((c) => c.code !== first)] : list;
};

module.exports = { ALL, valid, offered };
