const mongoose = require("mongoose");
const cacheInvalidation = require("../utils/cacheInvalidation");
const tags = require("../utils/cacheTags");
const singletonCache = require("../utils/singletonCache");

// Single document. Everything a buyer changes from the UI lives here rather
// than in .env, because a buyer should never have to edit a file and restart.

const THEME_NAMES = ["slate", "indigo", "emerald", "amber", "rose", "ocean", "crimson", "coral", "olive", "moss", "sky", "violet", "plum", "sepia", "sand", "graphite", "gold", "teal", "cobalt", "magenta", "materialGreen", "deepPurple", "custom"];

// A hand-set theme: one full light and one full dark palette, in the exact
// shape every preset theme already has (student-app/src/theme/tokens.js).
// Defaulted to slate's own values so switching to "custom" starts from a
// real, already-legible theme to edit from, not blank/black. A function so
// each place that uses it gets its own copy.
const customThemeShape = () => ({
  light: {
    primary: { type: String, default: "#14161A" },
    primaryFg: { type: String, default: "#FFFFFF" },
    accent: { type: String, default: "#3B5BA5" },
    bg: { type: String, default: "#FAFAFB" },
    surface: { type: String, default: "#FFFFFF" },
    surfaceAlt: { type: String, default: "#EFEFF2" },
    border: { type: String, default: "#E4E4E8" },
    text: { type: String, default: "#14161A" },
    textMuted: { type: String, default: "#71757F" },
  },
  dark: {
    primary: { type: String, default: "#E8E9EC" },
    primaryFg: { type: String, default: "#14161A" },
    accent: { type: String, default: "#8FA9DE" },
    bg: { type: String, default: "#101114" },
    surface: { type: String, default: "#191B20" },
    surfaceAlt: { type: String, default: "#22252C" },
    border: { type: String, default: "#2C3038" },
    text: { type: String, default: "#E8E9EC" },
    textMuted: { type: String, default: "#8D929C" },
  },
  // The banner gradient for the gradient designs (soft, y2k,
  // vaporwave, aurora), used in place of their built-in one when on.
  gradient: {
    enabled: { type: Boolean, default: false },
    from: { type: String, default: "#3B5BA5" },
    via: { type: String, default: "" },
    to: { type: String, default: "#B03A5E" },
    angle: { type: Number, default: 135, min: 0, max: 360 },
  },
});

const appSettingsSchema = new mongoose.Schema(
  {
    singleton: {
      type: String,
      default: "app",
      unique: true,
      immutable: true,
    },

    siteName: {
      type: String,
      default: "ExamAI",
    },
    logo: String,
    favicon: String,
    defaultCurrency: {
      type: String,
      default: "USD",
      uppercase: true,
    },
    defaultLocale: {
      type: String,
      default: "en",
    },

    // Printed on the student-facing purchase receipt only — never used for
    // login/branding chrome, which stays on siteName/logo above. All
    // optional: an installer who hasn't filled these in yet just gets a
    // receipt without them rather than blank lines, see Receipt.jsx.
    receiptInfo: {
      legalName: { type: String, default: null },
      address: { type: String, default: null },
      supportEmail: { type: String, default: null },
      supportPhone: { type: String, default: null },
      taxId: { type: String, default: null },
      // Tax invoices (utils/invoice.js). Prices include the tax.
      tax: {
        enabled: { type: Boolean, default: false },
        label: { type: String, default: "VAT" },
        rate: { type: Number, default: 0, min: 0, max: 100 },
        prefix: { type: String, default: "INV", maxlength: 12 },
        yearStartMonth: { type: Number, default: 1, min: 1, max: 12 },
        // India's GST: CGST + SGST when the student is in homeState, else
        // IGST. Students are asked for their state when this is on.
        gstSplit: { type: Boolean, default: false },
        homeState: { type: String, default: "" },
      },
    },

    // Meta tags for the student-facing landing page (LandingPage.jsx) — read
    // by an anonymous visitor's browser and by search-engine crawlers, never
    // gated behind auth, the same "safe as a storefront" reasoning as
    // siteName/logo. All optional: unset fields just mean the landing page
    // falls back to siteName as the title and no description/OG tag at all,
    // rather than a broken empty one.
    seo: {
      metaTitle: { type: String, default: null },
      metaDescription: { type: String, default: null },
      keywords: { type: [String], default: [] },
      ogImage: { type: String, default: null },
      // Only set when the institution runs on more than one hostname and
      // wants crawlers pointed at one canonical URL — most installs never
      // need this.
      canonicalUrl: { type: String, default: null },
      // Tells crawlers to skip the page entirely — for an install still
      // being set up, or a private/invite-only institution that doesn't
      // want to show up in search at all.
      noIndex: { type: Boolean, default: false },
      // Public course pages (/courses/<slug>): off keeps the landing page's
      // course pop-up; on links each course to its own page, in one of
      // three designs, listed in the sitemap.
      coursePages: { type: Boolean, default: false },
      courseDesign: { type: String, enum: ["spotlight", "magazine", "split"], default: "spotlight" },
      // The course pages' own colours: "app" follows the student app's
      // theme (studentUi.theme); a preset or "custom" replaces it on these
      // pages only. courseCustomTheme is read only when "custom".
      courseTheme: { type: String, enum: ["app", ...THEME_NAMES], default: "app" },
      courseCustomTheme: {
        ...customThemeShape(),
        // The Spotlight and Split banners' own colours. Empty: automatic
        // (text that reads on the banner, a white button in the accent).
        banner: {
          text: { type: String, default: "" },
          button: { type: String, default: "" },
          buttonText: { type: String, default: "" },
        },
      },
    },

    // Platform-wide switches, not a per-student preference — the admin
    // decides which event types are worth notifying about at all, and every
    // student gets the same answer. See utils/notify.js, which is the only
    // place that reads these: a type switched off here means the
    // Notification document is never created in the first place, not
    // merely hidden after the fact.
    notificationSettings: {
      doubtResolved: { type: Boolean, default: true },
      examGraded: { type: Boolean, default: true },
      examReview: { type: Boolean, default: true },
      newNotice: { type: Boolean, default: true },
      liveClassScheduled: { type: Boolean, default: true },
      studyPlanReady: { type: Boolean, default: true },
      examDisqualified: { type: Boolean, default: true },
      examReminder: { type: Boolean, default: true },
      // A support ticket answered or resolved by staff.
      ticketReply: { type: Boolean, default: true },
      // Warnings and actions on the student's account (Conduct).
      accountStanding: { type: Boolean, default: true },
      // Deletion scheduled, cancelled or approved.
      accountDeletion: { type: Boolean, default: true },
      // AI credits bought, extra course-chat questions unlocked.
      aiCredits: { type: Boolean, default: true },
      // A class the student missed: the recording, notes and quiz to catch up.
      liveClassMissed: { type: Boolean, default: true },
      // A new assignment set, and an assignment graded and returned.
      assignmentNew: { type: Boolean, default: true },
      assignmentGraded: { type: Boolean, default: true },
      // The assignment agent's reminder the day before work is due.
      assignmentReminder: { type: Boolean, default: true },
      // A certificate issued to the student.
      certificateIssued: { type: Boolean, default: true },
      referralReward: { type: Boolean, default: true },
      campaign: { type: Boolean, default: true },
      // The at-risk agent's personal check-in to a student who's slipping.
      studyNudge: { type: Boolean, default: true },
      // A study plan day ticked by the tutor from the student's own work.
      studyPlanDayDone: { type: Boolean, default: true },
    },

    adminUi: {
      layout: { type: String, enum: ["sidebar", "rail"], default: "sidebar" },
      theme: {
        type: String,
        enum: ["slate", "indigo", "emerald", "amber", "rose", "ocean", "crimson", "coral", "olive", "moss", "sky", "violet", "plum", "sepia", "sand", "graphite", "gold", "teal", "cobalt", "magenta", "materialGreen", "deepPurple"],
        default: "slate",
      },
      mode: { type: String, enum: ["light", "dark", "system"], default: "light" },
      density: { type: String, enum: ["comfortable", "compact"], default: "comfortable" },
    },

    // The board of AI video lessons (utils/videoLesson.js boardStyle): a
    // preset or custom colours, and the logo and name in a corner, in the
    // player and in recorded videos.
    videoBoard: {
      preset: { type: String, enum: ["whiteboard", "blackboard", "greenboard", "dark", "custom"], default: "whiteboard" },
      board: { type: String, default: null },
      ink: { type: String, default: null },
      accent: { type: String, default: null },
      showLogo: { type: Boolean, default: false },
      showName: { type: Boolean, default: false },
      corner: { type: String, enum: ["tl", "tr", "bl", "br"], default: "tr" },
      // How thoughts and callouts look (BoardPlayer.jsx Callout).
      callouts: { type: String, enum: ["soft", "sticky", "marker", "card", "quote", "plain"], default: "soft" },
    },

    // The in-app classroom's look (live class provider "LiveKit"): the
    // institution's logo in the room, an optional watermark over the video,
    // what students see while the host is away, and a promo line with a
    // link (the next batch, a sale). All optional.
    liveRoom: {
      showLogo: { type: Boolean, default: true },
      logo: { type: String, default: null }, // falls back to the platform logo
      watermark: { type: Boolean, default: false },
      watermarkPosition: { type: String, enum: ["tl", "tr", "bl", "br"], default: "br" },
      watermarkOpacity: { type: Number, default: 0.35, min: 0.05, max: 1 },
      // Each student's own name, faint across the video: a leaked screen
      // recording shows who recorded it.
      nameWatermark: { type: Boolean, default: false },
      accentColor: { type: String, default: null },
      waitingMessage: { type: String, default: null },
      waitingImage: { type: String, default: null },
      promoText: { type: String, default: null },
      promoLabel: { type: String, default: null },
      promoUrl: { type: String, default: null },
      // Where finished recordings go (utils/liveRecording.js send): kept on
      // this server ("storage"), or sent to a video provider so students
      // watch them in its protected player. recordingsAuto sends each one
      // when it finishes; recordingsKeepCopy keeps the server's file too.
      recordingsTo: { type: String, enum: ["storage", "vdocipher", "bunny", "vimeo"], default: "storage" },
      recordingsAuto: { type: Boolean, default: false },
      recordingsKeepCopy: { type: Boolean, default: false },
      // What a teacher assigned to an in-app class may do. Admins can always.
      teacherCanStart: { type: Boolean, default: true },
      teacherEarlyMinutes: { type: Number, default: 10, min: 0, max: 240 },
      teacherCanRecord: { type: Boolean, default: true },
      teacherCanEnd: { type: Boolean, default: true },
    },

    studentUi: {
      // "adaptive" picks app (bottom nav) vs web (sidebar) per viewport
      // width at render time (student-app/src/layout/Shell.jsx) rather than
      // fixing one for every device — "app"/"web" stay for an institution
      // that wants one look forced regardless of screen size.
      layout: { type: String, enum: ["app", "web", "adaptive"], default: "app" },
      // The site mascot (utils/mascot.js): a built-in character or one AI
      // drew from the admin's description (custom, checked shape data).
      // peekMinutes: how often it peeks in from the edge, 0 = never.
      // cheer: it reacts to right and wrong answers and good results.
      mascot: {
        enabled: { type: Boolean, default: false },
        name: { type: String, default: "", maxlength: 30 },
        preset: { type: String, enum: ["pip", "nib", "spark", "custom"], default: "pip" },
        custom: { type: mongoose.Schema.Types.Mixed, default: null },
        // The builder's picks behind a built mascot (admin MascotSettings),
        // so it reopens where it was left. Only short words and colours.
        built: { type: mongoose.Schema.Types.Mixed, default: null },
        description: { type: String, default: "", maxlength: 600 },
        peekMinutes: { type: Number, default: 4, min: 0, max: 60 },
        cheer: { type: Boolean, default: true },
      },
      design: {
        type: String,
        enum: [
          "panel", "editorial", "mono", "soft", "compact", "classic",
          "y2k", "neon", "vaporwave", "pixel", "aurora", "depth",
          "sketch", "khata", "swiss",
        ],
        default: "panel",
      },
      // Independent of "design" (panel/editorial/mono/soft/compact/classic/
      // y2k/neon/vaporwave/pixel/aurora/depth, which reshapes typography
      // and shape everywhere at once) — these two only pick the structural
      // layout of one screen each, on top of whichever design is active.
      // "list" is each screen's original layout, kept as the default so
      // nothing changes for anyone who doesn't touch this setting.
      batchHomeStyle: { type: String, enum: ["list", "iconGrid", "cardGrid", "bento", "tabs"], default: "list" },
      dashboardStyle: { type: String, enum: ["list", "richCards", "heroList", "editorial", "bento", "today"], default: "list" },
      // The home screen's column on a wide screen: against the left edge
      // (the original) or centred.
      homeAlign: { type: String, enum: ["left", "center"], default: "left" },
      // The sign-in, sign-up and reset-password pages' look (AuthShell.jsx).
      authStyle: { type: String, enum: ["hero", "split", "minimal", "glass", "bold"], default: "hero" },
      // Optional background picture for those pages, under a colour wash.
      authImage: { type: String, default: null },
      // Count visits for the admin Visitors page (utils/visitors.js).
      trackVisitors: { type: Boolean, default: true },
      // Look up visitors' city from their IP (utils/geo.js).
      visitorLocation: { type: Boolean, default: false },
      // On a phone, keep the top of the home and batch screens (notices,
      // the batch banner) small enough that the first things to tap show
      // on the first screen.
      compactMobile: { type: Boolean, default: true },
      // The same on a wider but short screen (a laptop, a tablet held
      // sideways: up to 820px tall).
      compactShort: { type: Boolean, default: true },
      // General notices on the student home page (the carousel).
      homeNotices: { type: Boolean, default: true },
      // How they show: cards (the carousel), banner, spotlight (wide
      // screens) or rail (wide screens, beside the home page).
      noticeStyle: { type: String, enum: ["cards", "banner", "spotlight", "rail"], default: "cards" },
      // On a phone, show the batch's teachers on its home screen. Wider
      // screens always show them.
      mobileTeachers: { type: Boolean, default: true },
      // On a phone, general notices fold into one slim line on the home
      // screen (tap opens the notice). Featured notices stay full cards.
      noticeStrip: { type: Boolean, default: false },
      // The home screen's course catalogue: "classic" (program photo
      // banner over logo cards), "photoLogo" (program photo behind each
      // card's logo, program name as type) or "list" (compact rows).
      catalogueStyle: { type: String, enum: ["classic", "photoLogo", "list"], default: "classic" },
      // "simple" is today's flat list, unchanged. "hierarchical" and
      // "hierarchicalCards" both group the same lectures by chapter then
      // topic, with per-group progress and collapsible chapters — they
      // differ only in row styling (a flat divided list vs. each lecture
      // in its own bordered card). See LectureListHierarchical.jsx and
      // LectureListHierarchicalCards.jsx.
      lectureListStyle: { type: String, enum: ["simple", "hierarchical", "hierarchicalCards"], default: "simple" },
      // The student's name drifting over videos: on every video, only on
      // ones the app plays itself (stored files and AI video lessons, not
      // Bunny/Vimeo/YouTube embeds, which have their own protection), or off.
      videoWatermark: { type: String, enum: ["all", "app", "off"], default: "all" },
      // Protected videos (self-hosted): starting one on a new device stops
      // it on the old one within about a minute.
      videoOneDevice: { type: Boolean, default: false },
      // The app's own video player (video files and protected videos):
      // its colour ("" = the brand colour), how far the skip buttons jump,
      // and which quality a protected video starts in.
      videoPlayer: {
        accent: { type: String, default: "" },
        skip: { type: Number, enum: [5, 10, 15, 30], default: 10 },
        startQuality: { type: String, enum: ["auto", "best"], default: "auto" },
      },
      // YouTube videos in the app's own locked player: YouTube's controls
      // off and a layer over it, so its links and right-click can't be used.
      youtubeLock: { type: Boolean, default: false },
      // The batch leaderboard: "podium" (the original: top 3 on a podium,
      // the rest in a list), "scoreboard" (one ranked table with a score
      // bar per row) or "spotlight" (the student's own standing first,
      // then score cards).
      leaderboardStyle: { type: String, enum: ["podium", "scoreboard", "spotlight"], default: "podium" },
      // The student's "My tutor" page: "console" (a robotic AI console:
      // animated robot, mission queue, reactor-ring progress) or "classic"
      // (plain cards, the original).
      tutorStyle: { type: String, enum: ["console", "classic"], default: "console" },
      // The page where a student picks a plan and pays: "classic" (the
      // original narrow list), "columns" (a pricing table, plans side by
      // side) or "aurora" (full screen, glass cards, a summary beside the
      // plans). See PlanPicker.jsx and PlanStyles.jsx.
      planStyle: { type: String, enum: ["classic", "columns", "aurora"], default: "classic" },
      // "My progress" level names, lowest band first (see LEVEL_BANDS in
      // utils/progress.js). An empty or missing entry keeps the default.
      levelTitles: { type: [String], default: undefined },
      // What students read when something goes wrong (student-app
      // utils/friendlyError.js). Empty keeps the built-in wording. "rules"
      // rewrite one specific message: shown text containing `match` becomes `text`.
      errorMessages: {
        general: { type: String, default: "" },
        network: { type: String, default: "" },
        rules: { type: [{ _id: false, match: String, text: String }], default: [] },
      },
      // Per-feature icon overrides for the student "Jump to" grid — unset
      // by default, meaning the app's own hardcoded icon (PlayCircle for
      // lectures, etc) is used exactly as before. Setting one here
      // switches that one feature to render through the same {kind, value}
      // preset/custom-upload system batches already use. Deliberately a
      // flat map of known keys, not a dynamic list — these features are
      // fixed in the code, not admin-defined. Has to actually live inside
      // studentUi (not as a sibling of it) — getPublicSettings only
      // forwards settings.studentUi to students, so anything outside it
      // never reaches the app no matter what else is correct.
      //
      // MUST list every key in settingsController.js's FEATURE_ICON_KEYS,
      // exactly — a key missing here isn't just unreachable from the admin
      // UI, it's actively dangerous: Mongoose casts an object assigned to a
      // nested-schema path (not Mixed/Map) by dropping any property not
      // declared on it, silently, with no error. That's exactly what
      // "notices" and "leaderboard" hit before this comment was written —
      // both accepted in FEATURE_ICON_KEYS and offered in Settings.jsx, but
      // undeclared here, so a custom upload for either was thrown away on
      // save and never persisted, with the upload response itself already
      // reflecting the stripped value (verified directly: constructing a
      // doc with an undeclared featureIcons key drops it synchronously,
      // before .save() is ever called).
      featureIcons: {
        lectures: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        practice: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        archive: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        exams: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        results: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        doubts: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        notices: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        leaderboard: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        liveClasses: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        studyPlan: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        aiCredits: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        progress: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        tutor: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        docChat: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        poraDhora: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        aiTutor: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        interview: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        // The archive's own internal hub (ArchiveHome.jsx) — a second,
        // smaller "Jump to" grid one level inside the "archive" tile above,
        // not a sibling of it.
        archiveBrowse: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        archiveStudyPlan: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        archiveExam: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
        archiveFavorites: { kind: { type: String, enum: ["preset", "custom"] }, value: String },
      },
      // Per-feature display-name overrides for the same "Jump to" grid —
      // unset by default, meaning the app's own hardcoded label ("Archive",
      // "Practice", etc.) is used exactly as before. Plain strings, not the
      // {kind,value} shape featureIcons uses, since there's no preset/custom
      // split for text. Same landmine as featureIcons above applies here:
      // MUST list every key in settingsController.js's FEATURE_ICON_KEYS
      // (shared with featureIcons — a name override and an icon override
      // are offered for the same fixed feature set), or a value for an
      // undeclared key is silently dropped by Mongoose on save.
      featureNames: {
        lectures: String,
        practice: String,
        archive: String,
        exams: String,
        results: String,
        doubts: String,
        notices: String,
        leaderboard: String,
        liveClasses: String,
        studyPlan: String,
        aiCredits: String,
        progress: String,
        tutor: String,
        docChat: String,
        poraDhora: String,
        aiTutor: String,
        interview: String,
        archiveBrowse: String,
        archiveStudyPlan: String,
        archiveExam: String,
        archiveFavorites: String,
      },
      theme: {
        type: String,
        enum: THEME_NAMES,
        default: "slate",
      },
      // Only read when theme === "custom" — every field an admin can set by
      // hand (customThemeShape above).
      customTheme: customThemeShape(),
      mode: { type: String, enum: ["light", "dark", "system"], default: "light" },
      allowModeOverride: { type: Boolean, default: true },
      // Free-text Google Fonts family names — deliberately not an enum like
      // theme/design above, since the whole point is letting an admin reach
      // fonts (Bangla scripts especially) no fixed preset list could cover.
      // null means "use the active design's own font" (DESIGNS in
      // buildTheme.js), so this is purely additive: an install that never
      // touches it renders exactly as before. Loaded client-side from
      // Google Fonts by name (App.jsx) — an admin who mistypes a family
      // just gets the design's own fallback font, nothing breaks.
      fonts: {
        heading: { type: String, default: null, trim: true },
        body: { type: String, default: null, trim: true },
      },
      // The small "Batch — Page" breadcrumb chip (BatchSwitcher.jsx's
      // BatchContextCard) sitting above lecture/exam/practice lists once a
      // student is inside a specific batch. "glass" is the original —
      // translucent, blurred, a hardcoded accent color independent of the
      // active theme. "solid" and "minimal" are alternatives for
      // institutions whose theme or design (e.g. editorial/mono/compact)
      // reads oddly against a floating glass effect.
      batchContextStyle: { type: String, enum: ["glass", "solid", "minimal"], default: "glass" },
    },

    // Which identifier the registration form asks for. Independent of what
    // is actually deliverable (that's SMS_PROVIDER/SMTP_* in the
    // environment) — this only controls what students are offered, checked
    // against real capability at the point of use rather than here, the
    // same way a video driver stays selectable in the UI right up until
    // someone tries to use it unconfigured.
    // Conduct (admin → Conduct). The automatic rule: this many abuse flags
    // (not dismissed) within windowDays pauses the student's AI features
    // for pauseDays.
    conduct: {
      autoPause: { type: Boolean, default: false },
      flags: { type: Number, default: 3, min: 1 },
      windowDays: { type: Number, default: 30, min: 1 },
      pauseDays: { type: Number, default: 7, min: 1 },
      // Exam integrity flags on one attempt before it shows here at all.
      examFlags: { type: Number, default: 3, min: 1 },
      // The away limit new exams start with (each exam can change it).
      awayMode: { type: String, enum: ["off", "submit", "abandon"], default: "off" },
      awayMinutes: { type: Number, default: 5, min: 1 },
      // Which exam flags are watched for. Off: never sent, never logged.
      watch: {
        tabSwitch: { type: Boolean, default: true },
        leftWindow: { type: Boolean, default: true },
        paste: { type: Boolean, default: true },
        leftPage: { type: Boolean, default: true },
      },
    },

    // Support tickets: a resolved ticket can be reopened by the student's
    // reply for this many days after it was resolved; then it's closed for
    // good and they open a new one. 0 = closed as soon as it's resolved.
    support: {
      reopenDays: { type: Number, default: 7, min: 0 },
    },

    // Students asking to delete their account (Account page): whether they
    // can, how long they have to change their mind, and whether the erase
    // then happens by itself or waits for staff approval.
    accountDeletion: {
      enabled: { type: Boolean, default: true },
      graceDays: { type: Number, default: 14, min: 0 },
      autoDelete: { type: Boolean, default: true },
    },

    studentAuth: {
      identifier: { type: String, enum: ["email", "phone", "both"], default: "email" },
      // "Log in with a code instead" on the login screen.
      codeLogin: { type: Boolean, default: true },
      // Countries students can sign up and log in from by phone (ISO codes),
      // and the one the picker starts on.
      countries: { type: [String], default: ["BD"] },
      defaultCountry: { type: String, default: "BD" },
    },

    // What kind of institution this is (utils/institution.js): the words
    // both apps use for batches, programs and teachers, and whether it sells
    // access. `labels` are the admin's own words over the preset, each
    // empty for the preset's. A school or university usually doesn't sell:
    // sales off hides plans, prices and checkout, and access is given by
    // staff (Students → Grant access, or the import).
    // Grading pay and workflow (utils/gradingFlow.js). Pay counts graded
    // answers ("question") or finished scripts ("script"); a rate of 0
    // shows counts only. "script" also keeps a part-marked script with its
    // grader. stuckHours: a part-marked script with no progress this long
    // is flagged for an admin. regradeHours: how long a regrade waits for
    // the person it was sent to before anyone on the batch may do it.
    grading: {
      payMode: { type: String, enum: ["question", "script"], default: "question" },
      ratePerQuestion: { type: Number, min: 0, default: 0 },
      ratePerScript: { type: Number, min: 0, default: 0 },
      stuckHours: { type: Number, min: 1, max: 720, default: 24 },
      regradeHours: { type: Number, min: 1, max: 720, default: 48 },
    },
    // Team pay (utils/teamPay.js). doubtRate: pay per doubt a solver
    // answers. sellerPercent: a seller's commission on sales made with their
    // coupons. 0 shows counts only.
    teamPay: {
      doubtRate: { type: Number, min: 0, default: 0 },
      sellerPercent: { type: Number, min: 0, max: 100, default: 0 },
    },
    // Rules for paying teachers for live classes (utils/classPay.js). Each
    // teacher's own rate is on their account (user.classPay).
    classPay: {
      // A class that ran shorter than this isn't paid.
      minMinutes: { type: Number, min: 0, max: 600, default: 10 },
      // A class no student joined: still paid, or not.
      payEmpty: { type: Boolean, default: true },
      // Hourly pay rounds each class's minutes to the nearest step.
      roundMinutes: { type: Number, enum: [1, 5, 15, 30], default: 15 },
      // Without overtime, a class pays at most its scheduled length plus this.
      graceMinutes: { type: Number, min: 0, max: 600, default: 15 },
      // A class cancelled less than lateCancelHours before it starts pays
      // lateCancelPercent of a normal class. 0: not paid.
      lateCancelHours: { type: Number, min: 0, max: 168, default: 2 },
      lateCancelPercent: { type: Number, min: 0, max: 100, default: 0 },
      // Taken off for each in-app class a teacher was on but never joined.
      // 0: nothing taken off.
      noShowDeduction: { type: Number, min: 0, default: 0 },
    },
    // Certificates (utils/certificates.js): the default wording and
    // signatures. {name}, {batch}, {program}, {grade} and {date} are filled
    // in when a certificate is issued.
    // Progress reports (utils/progressReports.js). Per-batch schedules and
    // recipients live on the batch; these apply everywhere.
    progressReports: {
      enabled: { type: Boolean, default: false },
      // IANA zone the schedule's day and hour are read in. Empty: the
      // server's TZ, else from the currency (BDT → Asia/Dhaka), else UTC.
      timezone: { type: String, trim: true, default: "" },
      // For local numbers without a country code. Empty: from the currency.
      phoneCountry: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
      // SMS parts a month across every batch; 0 = no limit.
      smsMonthlyCap: { type: Number, min: 0, default: 0 },
      // Cost of one SMS part, for the estimate shown before sending.
      smsPartCost: { type: Number, min: 0, default: 0 },
      // Students may add a guardian when none is on record; changing one
      // already set is for staff only unless this is on.
      studentCanEditGuardian: { type: Boolean, default: false },
      // How long the link in a report keeps working.
      linkDays: { type: Number, min: 1, max: 365, default: 60 },
    },
    certificates: {
      title: { type: String, trim: true, maxlength: 80, default: "Certificate of Completion" },
      body: { type: String, trim: true, maxlength: 600, default: "This is to certify that {name} has successfully completed {batch}." },
      signatures: [
        {
          _id: false,
          name: { type: String, trim: true, maxlength: 60, default: "" },
          role: { type: String, trim: true, maxlength: 60, default: "" },
          // An uploaded or drawn signature (PNG), shown above the line.
          image: { type: String, default: null },
        },
      ],
      style: { type: String, enum: ["classic", "modern"], default: "classic" },
    },
    institution: {
      type: { type: String, enum: ["coaching", "school", "college", "university", "bootcamp"], default: "coaching" },
      labels: {
        batch: { type: String, default: "" },
        batches: { type: String, default: "" },
        program: { type: String, default: "" },
        programs: { type: String, default: "" },
        teacher: { type: String, default: "" },
        teachers: { type: String, default: "" },
        org: { type: String, default: "" },
      },
      sales: { type: Boolean, default: true },
      // Students log in with their student ID (Student.studentId) and a
      // password, no email or SMS needed: for imported students.
      studentIdLogin: { type: Boolean, default: false },
      // Gives each student an ID from this pattern when their profile is
      // complete (utils/studentIdPattern.js). Empty: IDs only by hand.
      studentIdPattern: { type: String, default: "" },
    },

    // Referrals (utils/referrals.js). Every student gets a code; a friend
    // using it gets the discount, and once the friend's paid purchase
    // completes the student gets the reward: a one-use coupon or AI credits.
    referrals: {
      enabled: { type: Boolean, default: false },
      discountType: { type: String, enum: ["percent", "fixed"], default: "percent" },
      discountValue: { type: Number, min: 0, default: 10 },
      // The code works only on a friend's first purchase.
      newStudentsOnly: { type: Boolean, default: true },
      reward: {
        kind: { type: String, enum: ["coupon", "aiCredits", "none"], default: "coupon" },
        discountType: { type: String, enum: ["percent", "fixed"], default: "percent" },
        discountValue: { type: Number, min: 0, default: 10 },
        // A reward coupon expires this many days after it is given.
        validDays: { type: Number, min: 1, max: 3650, default: 90 },
        credits: { type: Number, min: 0, default: 20 },
        // Rewards one student can earn in all; 0 = no limit.
        maxPerStudent: { type: Number, min: 0, default: 0 },
      },
    },

    modules: {
      lectures: { type: Boolean, default: false },
      practice: { type: Boolean, default: true },
      ai: { type: Boolean, default: false },
    },

    // manual payment recording — configurable so a buyer can define their own
    manualPaymentMethods: {
      type: [String],
      default: ["Cash", "Bank transfer"],
    },
  },
  { timestamps: true }
);

// Cached for a few seconds, see utils/singletonCache.js.
singletonCache.attach(appSettingsSchema, "AppSettings");

appSettingsSchema.statics.get = async function () {
  return this.cachedGet("plain", async () => {
    let settings = await this.findOne({ singleton: "app" });
    if (!settings) {
      settings = await this.create({ singleton: "app" });
    }
    return settings;
  });
};

// Writes here drop the cached reads built from them (utils/cacheInvalidation.js).
appSettingsSchema.plugin(cacheInvalidation, { tags: () => [tags.LANDING] });

module.exports = mongoose.model("AppSettings", appSettingsSchema);
