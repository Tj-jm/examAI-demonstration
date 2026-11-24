const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");

// The fixed catalogue of section kinds this platform ships with. "Fixed"
// means every one of these always exists in a landing page's sections
// array (seeded on first creation, never deletable) — an admin only ever
// toggles them on/off and edits their content. customHtml is the one
// exception: freely addable and removable, since it's inherently ad hoc.
const SECTION_TYPES = ["hero", "stats", "catalogue", "teachers", "about", "faq", "notices", "updates", "interest", "footer", "customHtml"];

const sectionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: SECTION_TYPES,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    // Freeform per-type content — see landingPageController.js's
    // shapeSection for what each type actually reads out of this.
    // Deliberately Mixed rather than a rigid sub-schema per type: seven
    // fixed types would otherwise need seven near-identical schema
    // branches for fields that are genuinely just "whatever text, image,
    // or (for customHtml specifically) raw markup this section shows".
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const landingPageSchema = new mongoose.Schema(
  {
    singleton: {
      type: String,
      default: "landing",
      unique: true,
      immutable: true,
    },
    // Display order is array position, not a separate order field on each
    // section — the one admin action that ever changes what shows first
    // (reordering) is then the only thing that can change it, rather than
    // an order number that could quietly drift out of sync with position.
    sections: [sectionSchema],
  },
  { timestamps: true }
);

// Seeded once, on first ever request for this document. Hero, catalogue
// and footer default to visible — a freshly installed platform should have
// a landing page that already looks like something, not a blank shell an
// admin has to first discover needs switching on. The rest default off
// until an admin actually has content for them.
const DEFAULT_SECTIONS = [
  // heroLayout: "classic" | "split" | "centeredCards" — which of the three
  // arrangements student-app/src/pages/LandingPage.jsx's HeroSection draws.
  // "classic" here so an existing install's saved sections (already missing
  // this key) and a fresh one both explicitly mean the same thing; the
  // renderer also defaults to "classic" on its own for any doc saved before
  // this field existed.
  { type: "hero", enabled: true, content: { heading: "Learn without limits", subheading: "Everything you need to prepare for your exams, in one place.", ctaLabel: "Get started", heroLayout: "classic" } },
  // statsLayout: "classic" | "cards" | "inline" — see StatsSection in
  // student-app/src/pages/LandingPage.jsx.
  { type: "stats", enabled: false, content: { items: [], statsLayout: "classic" } },
  // catalogueLayout: "grid" | "list" | "carousel" — see CatalogueSection.
  { type: "catalogue", enabled: true, content: { heading: "Explore our courses", subheading: "", catalogueLayout: "grid" } },
  // teachersLayout: "grid" | "carousel" | "list" — see TeachersSection.
  // teacherIds: who shows, in order; empty means every teacher whose
  // profile is public.
  { type: "teachers", enabled: false, content: { heading: "Meet our teachers", subheading: "", teachersLayout: "grid", teacherIds: [] } },
  // aboutLayout: "classic" | "imageRight" | "centered" — see AboutSection.
  { type: "about", enabled: false, content: { heading: "About us", body: "", aboutLayout: "classic" } },
  // faqLayout: "accordion" | "twoColumn" | "cards" — see FaqSection.
  { type: "faq", enabled: false, content: { heading: "Frequently asked questions", items: [], faqLayout: "accordion" } },
  { type: "notices", enabled: false, content: { heading: "Announcements" } },
  { type: "updates", enabled: false, content: { heading: "What's new" } },
  // The interest form: visitors leave a name and number (utils/leads.js).
  { type: "interest", enabled: false, content: { heading: "Want to know more?", subheading: "Leave your number and we'll get back to you.", button: "Call me back", askBatch: true, askEmail: false, askMessage: false, thanks: "Thanks! We'll be in touch soon." } },
  { type: "footer", enabled: true, content: { text: "", links: [] } },
];

landingPageSchema.statics.get = async function () {
  let doc = await this.findOne({ singleton: "landing" });
  if (!doc) {
    doc = await this.create({ singleton: "landing", sections: DEFAULT_SECTIONS });
    return doc;
  }

  // A fixed type introduced after this document already existed (faq,
  // here, added after hero/stats/catalogue/etc.) has no way to already be
  // present in it — added once, automatically, so an existing install
  // picks up a new built-in section on its own instead of every future
  // save failing landingPageController.js's "every fixed type exactly
  // once" check until an admin somehow knows to work around a gap they
  // had no way of causing.
  const existingTypes = new Set(doc.sections.map((s) => s.type));
  const missing = DEFAULT_SECTIONS.filter((s) => s.type !== "customHtml" && !existingTypes.has(s.type));
  if (missing.length > 0) {
    // In before the footer, which stays last.
    const footerAt = doc.sections.findIndex((s) => s.type === "footer");
    if (footerAt >= 0) doc.sections.splice(footerAt, 0, ...missing);
    else doc.sections.push(...missing);
    await doc.save();
  }

  return doc;
};

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
landingPageSchema.plugin(cacheInvalidation, { tags: () => [tags.LANDING] });

const LandingPage = mongoose.model("LandingPage", landingPageSchema);
LandingPage.SECTION_TYPES = SECTION_TYPES;

module.exports = LandingPage;
