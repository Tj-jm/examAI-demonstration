const { z } = require("zod");
const { call } = require("../invoke");
const { routeTool } = require("./routeTool");

// Copilot tool for the Settings drawer: how the student app looks.

const LOOK = {
  dashboardStyle: ["Home screen", ["list", "richCards", "heroList", "editorial", "bento", "today"]],
  batchHomeStyle: ["Batch page", ["list", "iconGrid", "cardGrid", "bento", "tabs"]],
  homeAlign: ["Page position", ["left", "center"]],
  authStyle: ["Sign-in page", ["hero", "split", "minimal", "glass", "bold"]],
  noticeStyle: ["Notices", ["cards", "banner", "spotlight", "rail"]],
  catalogueStyle: ["Course list", ["classic", "photoLogo", "list"]],
  lectureListStyle: ["Lecture list", ["simple", "hierarchical", "hierarchicalCards"]],
};

const tools = {
  student_app_look: routeTool({
    label: "Change how the student app looks",
    drawer: "settings",
    risk: "publish",
    roles: ["owner", "admin"],
    schema: z.object({
      siteName: z.string().min(1).max(80).optional(),
      ...Object.fromEntries(Object.entries(LOOK).map(([k, [, values]]) => [k, z.enum(values).optional()])),
    }),
    async load() {
      const s = await require("../../models/appSettingsModel").get();
      const ui = s.studentUi || {};
      return { id: "settings", name: "Settings", link: "/settings", before: { siteName: s.siteName, ...Object.fromEntries(Object.keys(LOOK).map((k) => [k, ui[k] || null])) } };
    },
    after: (a, { before }) => Object.fromEntries(Object.keys(before).filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
    labels: { siteName: "Site name", ...Object.fromEntries(Object.entries(LOOK).map(([k, [label]]) => [k, label])) },
    apply(a, ctx) {
      const studentUi = Object.fromEntries(Object.keys(LOOK).filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const body = { ...(a.siteName !== undefined ? { siteName: a.siteName } : {}), ...(Object.keys(studentUi).length ? { studentUi } : {}) };
      return call(require("../../controllers/admin/settingsController").updateSettings, { user: ctx.user, body });
    },
    summary: () => "The student app's look is updated.",
  }),
};

module.exports = { tools };
