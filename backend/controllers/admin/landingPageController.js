const asyncHandler = require("express-async-handler");
const LandingPage = require("../../models/landingPageModel");

// Every one of the seven fixed types must appear exactly once — an admin
// can toggle one off or reorder it, but the whole-array PUT below is
// trusted to still describe a complete landing page, not a partial one
// missing "footer" because a bug (or a hand-crafted request) forgot it.
// customHtml has no such requirement: any number, including zero.
const validateSections = (sections) => {
  if (!Array.isArray(sections) || sections.length === 0) {
    return "At least one section is required.";
  }

  for (const section of sections) {
    if (!LandingPage.SECTION_TYPES.includes(section.type)) {
      return `"${section.type}" is not a recognised section type.`;
    }
  }

  const fixedTypes = LandingPage.SECTION_TYPES.filter((t) => t !== "customHtml");
  for (const type of fixedTypes) {
    const count = sections.filter((s) => s.type === type).length;
    if (count !== 1) {
      return `The "${type}" section has to appear exactly once — found ${count}. It can be switched off, but not removed.`;
    }
  }

  return null;
};

//@desc   The full landing page configuration, including disabled sections
//        — the editor needs to see and edit those too, unlike the public
//        endpoint (publicController.js's getPublicLandingPage) which only
//        ever returns what's actually enabled.
//@route  GET /api/landing-page
//@access Private (owner, admin)
const getLandingPage = asyncHandler(async (req, res) => {
  const page = await LandingPage.get();
  res.status(200).json(page);
});

//@desc   Replace the whole sections array — reordering, editing a
//        section's content, toggling enabled, and adding or removing a
//        customHtml block are all just different edits to this one array,
//        saved together rather than as separate granular endpoints. The
//        admin UI builds up a local draft and saves it whole, the same
//        pattern this project already uses for a batch's plan list.
//@route  PUT /api/landing-page
//@access Private (owner, admin)
const updateSections = asyncHandler(async (req, res) => {
  const { sections } = req.body;

  const error = validateSections(sections);
  if (error) {
    res.status(400);
    throw new Error(error);
  }

  const page = await LandingPage.get();
  page.sections = sections;
  await page.save();

  res.status(200).json(page);
});

module.exports = { getLandingPage, updateSections };
