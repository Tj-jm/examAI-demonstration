// A free first check for abusive messages, before any AI is paid for:
// strong profanity and slurs in English, Banglish (Bangla in Latin
// letters) and Bangla script. Mild words ("stupid", "idiot") are left out
// on purpose — students use them about questions, not people — and the AI
// judges what a list can't (see the "abusive" field on chat answers).

// Latin roots: a word starting with one of these matches ("fucking").
const LATIN_ROOTS = [
  "fuck", "motherfuck", "shit", "bitch", "bastard", "asshole", "cunt", "whore", "slut", "retard",
  // Banglish
  "bokachod", "khanki", "haramjad", "haramzad", "harami", "beshya", "bessha", "shuorer", "shuyorer",
  "kuttarbacha", "kuttarbaccha", "chutmarani", "chudani",
];
// Short words that are only abusive as the whole word ("magi", not
// "magic"; "chod", not "choddo" — fourteen).
const LATIN_WORDS = new Set([
  "fuk", "fuking", "fck", "fcking", "fk",
  "magi", "magir", "magider", "chod", "choda", "chodi", "chode", "chodbo", "chodon", "chodna",
  "chud", "chuda", "chudi", "chudir", "chude", "chudai", "chudbo", "gandu", "baler", "khankir",
]);
// Several-word Banglish phrases, matched on the joined text.
const LATIN_PHRASES = ["kuttar bacha", "kuttar baccha", "shuorer bacha", "shuor er bacha", "tor mayre", "tor maire", "tor mare", "boka choda"];
// Bangla script: matched anywhere (Bangla adds its endings to the word).
const BANGLA = [
  "চোদা", "চুদি", "চুদা", "চুদানি", "চোদন", "মাগি", "মাগী", "খানকি", "খানকী", "হারামজাদা", "হারামজাদি", "হারামি", "হারামী",
  "শুয়োরের বাচ্চা", "শুওরের বাচ্চা", "কুত্তার বাচ্চা", "বোকাচোদা", "বালের", "গান্ডু", "বেশ্যা", "চুতমারানি",
];

const LEET = { "@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "!": "i" };

const latinForms = (text) => {
  const lower = String(text || "").toLowerCase().replace(/[@$013457!]/g, (c) => LEET[c]);
  // "fuuuck" → "fuck": runs of the same letter squeezed to one.
  const squeezed = lower.replace(/([a-z])\1+/g, "$1");
  return [lower, squeezed];
};

// → the matched word, or null.
const findAbuse = (text) => {
  const raw = String(text || "").normalize("NFC");
  for (const word of BANGLA) if (raw.includes(word)) return word;
  for (const form of latinForms(raw)) {
    const joined = form.replace(/[^a-z]+/g, " ").trim();
    for (const phrase of LATIN_PHRASES) if (` ${joined} `.includes(` ${phrase} `)) return phrase;
    const words = joined.split(" ");
    for (const w of words) {
      if (LATIN_WORDS.has(w)) return w;
      const root = LATIN_ROOTS.find((r) => w.startsWith(r) || w.startsWith(r.replace(/([a-z])\1+/g, "$1")));
      if (root) return root;
    }
  }
  return null;
};

module.exports = { findAbuse };
