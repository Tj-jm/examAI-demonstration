import { useEffect, useState } from "react";
import MascotSettings from "../components/MascotSettings";
import InterviewSets from "../components/InterviewSets";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useOutletContext } from "react-router-dom";
import { setTheme, setMode, setLayout } from "../uiSlice";
import { themes, themeNames } from "../theme/themes";
import { useGetAiConfigQuery, useUpdateAiConfigMutation, useTestAiConnectionMutation } from "../api/aiConfigApi";
import {
  useGetGeneralCreditPlansQuery,
  useAddGeneralCreditPlanMutation,
  useUpdateGeneralCreditPlanMutation,
  useDeleteGeneralCreditPlanMutation,
  useGetDocChatQuestionsQuery,
} from "../api/aiApi";
import {
  useGetSettingsQuery,
  useUpdateSettingsMutation,
  useUploadLogoMutation,
  useUploadFaviconMutation,
  useUploadFeatureIconMutation,
  useUpdatePaymentGatewayMutation,
  useSuggestSeoMetaMutation,
  useGetCleanupQuery,
  useRunCleanupMutation,
  useGetMediaProvidersQuery,
  useGetProtectedSummaryQuery,
  useProtectAllMediaMutation,
} from "../api/contentApi";
import {
  Palette, Sparkles, ToggleRight, MessagesSquare, Lock, Check, AlertTriangle, Plug, Monitor, Sun, Moon,
  Building2, UploadCloud, Smartphone, LayoutDashboard, MonitorSmartphone, Mail, MessageSquare,
  BookOpen, PlayCircle, Dumbbell, PenLine, Trophy, HelpCircle, Wallet, Plus, Trash2, Megaphone, Bell, Crown,
  Terminal, Heart, Rows3, ScrollText, Gem, Zap, Waves, Gamepad2, Rainbow, Layers, NotebookPen, Grid3x3, Receipt, Search, Wand2, EyeOff,
  Video, CalendarCheck, Code2, Library, RotateCcw, Star, ClipboardList, Gauge,
  AudioLines, Database,
  School, Gift, Mic,
  Users as UsersIcon,
} from "lucide-react";
import VoiceSettings from "../components/VoiceSettings";
import ImageSettings from "../components/ImageSettings";
import VideoBoardSettings from "../components/VideoBoardSettings";
import IconPicker from "../components/IconPicker";
import { AgentsGlyph, TutorAgentIcon } from "../components/AgentIcons";
import BatchIcon from "../components/BatchIcon";
import { ErrorNote, Field, Loading, TeacherLocked, Verdict, useConfirm, PasswordInput } from "../components/bits";
import LocalModels from "../components/LocalModels";
import { ImagePicker } from "../components/MediaPickers";
import EmbeddedModels from "../components/EmbeddedModels";
import AgentSettings from "../components/AgentSettings";
import InstitutionSettings from "./InstitutionSettings";
import GradingSettings, { TeamPaySettings } from "./GradingSettings";
import ReferralSettings from "./ReferralSettings";
import Connections from "../components/Connections";
import CourseDesignPicker from "../components/CourseDesignPicker";
import CourseSeoList from "../components/CourseSeoList";
import QuickBrand from "../components/QuickBrand";
import EmailLook from "../components/EmailLook";


const PROVIDERS = [
  { value: "embedded", label: "Built-in (no setup)" },
  { value: "custom", label: "Local or self-hosted" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
];

const NOTIFICATION_TYPES = [
  ["doubtResolved", "Doubt resolved", "When a doubt solver answers a student's question."],
  ["assignmentNew", "New assignment", "When an assignment is published, to every student in its batch."],
  ["assignmentGraded", "Assignment graded", "When a grade is returned to the student."],
  ["certificateIssued", "Certificate issued", "When a certificate is issued to the student, with a link to view and print it."],
  ["assignmentReminder", "Assignment due tomorrow", "The assignment agent's reminder to students who haven't handed in work due within a day."],
  ["examGraded", "Exam graded", "The moment a submission finishes grading — instantly for an all-objective paper, or once the last written answer is marked."],
  ["newNotice", "New notice", "When a notice goes live, to everyone it reaches — every student for a general notice, everyone with access for a batch one."],
  ["studyPlanReady", "Study plan ready", "When a student's 7-day study plan finishes generating."],
  ["examDisqualified", "Exam disqualified / reinstated", "When an owner or admin disqualifies one of a student's exam attempts, or reverses that decision."],
  ["examReminder", "Exam reminders", "A day before, and an hour before, a scheduled exam opens."],
  ["examReview", "Regrade decided", "When a student's request to recheck an exam answer is decided."],
  ["liveClassScheduled", "Live class scheduled", "When a live class is scheduled for a batch the student has."],
  ["liveClassMissed", "Missed a live class", "The after-class agent's catch-up message to students who didn't attend."],
  ["studyNudge", "Check-ins", "The at-risk agent's personal check-in to a student who's slipping."],
  ["studyPlanDayDone", "Study plan day done", "When the tutor ticks a study plan day because the student did that day's work."],
  ["ticketReply", "Support ticket replies", "When staff reply to or resolve a student's support ticket."],
  ["accountStanding", "Account standing", "Flagged messages, warnings, AI pauses and suspensions (Conduct)."],
  ["accountDeletion", "Account deletion", "When a deletion is requested, cancelled or rejected."],
  ["aiCredits", "AI credits", "When AI credits are added or extra course-chat questions are unlocked."],
  ["campaign", "Campaigns", "Campaign messages sent from the Campaigns page by app notification. Off: campaigns go by SMS and email only."],
  ["referralReward", "Referral reward", "When a friend buys with the student's referral code and the student gets their reward."],
];

const FEATURES = [
  ["questionGeneration", "Generate questions", "Write questions from your own material."],
  ["solutionBackfill", "Write missing solutions", "Fill in explanations for questions that have none."],
  ["skillTypeBackfill", "Classify skill type", "Let AI suggest a skill type (recall, application, etc.) for a question on request."],
  ["qualityChecks", "Check questions for errors", "Catch wrong answer keys and ambiguous wording."],
  ["writtenGrading", "Grade written answers", "Lets graders ask AI to suggest a mark for written exam answers, against your rubric. You always have the final say. Batches also need AI assist + AI exam grading on."],
  ["studentExplanations", "Explain mistakes to students", "The \"Explain why\" button in practice and the archive — why their answer was wrong, not just the right one. Batches' own AI switches still apply."],
  ["studyPlanFree", "Free study plans", "Skip credit/cap charges when a student generates or regenerates their study plan. Off by default, like every other billable feature."],
  ["smartExamBuilder", "AI: pick exam questions", "Lets the exam builder fill a target count of questions from your bank, split across types, when you use \"Add questions\" > \"AI pick\"."],
  ["lectureDescription", "AI: write lecture descriptions", "Adds a \"Write with AI\" button next to a lecture's description field, drafted from its written notes."],
  ["seoSuggest", "AI: suggest SEO text", "Lets \"Suggest with AI\" in landing page settings draft the site's search title and description."],
  ["assignmentChecking", "AI: check assignments", "A suggested grade and feedback for each assignment hand-in, read from the typed answer and photos of the work. Staff accept or change it; it never reaches the student on its own."],
  ["writingHelp", "AI: write with AI", "\"Write with AI\" on exam descriptions, notices and their phone line, landing page sections and live classes, plus the translate button."],
  ["aiImages", "AI: pictures and diagrams", "\"AI diagram\" on question and solution images (drawn by your AI model, opened in the editor to check), and \"AI picture\" on notice and landing page images (needs a picture service below)."],
  ["docChat", "Course chat for students", "\"Ask this lecture\" and \"Ask your course\": students ask questions and get answers from the lecture notes and files, showing the page each answer comes from. Batches also need AI help + Course chat on."],
  ["practiceQna", "Questions on practice solutions", "After answering a practice question, students ask about a step they didn't follow (\"I don't get line 4\"). AI only spells out that solution's steps and declines anything else. Batches also need AI help + Questions on solutions on."],
  ["poraDhora", "Oral Quiz for students", "An AI teacher asks a student about a lecture out loud, follows up, marks each spoken answer and writes a short report. Needs lecture notes or readable files. Batches also need AI help + Oral Quiz on."],
  ["aiTutor", "AI Tutoring for students", "A written lesson check: an AI tutor asks about a lecture, marks each answer like an exercise book, or sets a board-style creative question and marks each part. Needs lecture notes or readable files. Batches also need AI help + AI Tutoring on."],
  ["interview", "Interview practice for students", "A viva or interview panel of AI interviewers asks a student out loud (board viva, admission, scholarship or job interview), follows up on the answers and writes feedback with scores and tips. Batches also need AI help + Interview practice on."],
  ["studentVideos", "Short AI videos for students", "From a lecture or AI video, students ask for a short video on one point (\"elaborate the proof\"), made from that lecture. Needs a voice set up under Voice for narration (captions otherwise). Batches also need AI help + Short AI videos on."],
];

// Keys must match backend/ai/featureCosts.js's FEATURE_COST_KEYS exactly —
// this is what a student is actually charged, in purchased AI credits,
// once their free daily calls on a batch run out. Doesn't touch the free
// daily count itself, which stays a flat one-call-is-one-call regardless
// of feature.
// The student "Jump to" grid (BatchHome.jsx) — shared between the "Feature
// icons" and "Feature names" sections below, since both override the same
// fixed feature set. Matches BatchHome.jsx's own tile order.
const JUMP_TO_FEATURES = [
  ["lectures", "Lectures", PlayCircle],
  ["practice", "Practice", Dumbbell],
  ["codingPractice", "Coding practice", Code2],
  ["archive", "Archive", Library],
  ["exams", "Exams", PenLine],
  ["results", "Results", Trophy],
  ["progress", "My progress", Gauge],
  ["notices", "Notice Central", Megaphone],
  ["leaderboard", "Leaderboard", Crown],
  ["doubts", "Doubts", HelpCircle],
  ["liveClasses", "Live Classes", Video],
  ["tutor", "My tutor", TutorAgentIcon],
  ["studyPlan", "Study Plan", CalendarCheck],
  ["docChat", "Ask your course", MessagesSquare],
  ["poraDhora", "Oral Quiz", Mic],
  ["aiTutor", "AI Tutoring", PenLine],
  ["interview", "Interview practice", UsersIcon],
  ["aiCredits", "AI credits", Zap],
];

// "My progress" level names, lowest band first. Must match LEVEL_BANDS in
// backend/utils/levelTitles.js.
const LEVEL_BANDS = [
  [1, "Rookie"], [3, "Learner"], [5, "Explorer"], [8, "Achiever"],
  [11, "Scholar"], [15, "Expert"], [20, "Master"], [30, "Legend"],
];

// The archive's own internal hub (ArchiveHome.jsx) — a second, smaller
// "Jump to" grid one level inside the "Archive" tile above, not a sibling
// of it. Same icon/name override machinery, offered as its own section
// since these are a different fixed feature set from JUMP_TO_FEATURES.
const ARCHIVE_HUB_FEATURES = [
  ["archiveBrowse", "Browse & Practice", BookOpen],
  ["archiveStudyPlan", "Archive Study Plan", CalendarCheck],
  ["archiveExam", "Build a practice exam", ClipboardList],
  ["archiveFavorites", "My Favorites", Star],
];

const FEATURE_COSTS = [
  ["doubt-solve", "Doubt solved by AI", "No image attached."],
  ["doubt-solve-image", "Doubt solved by AI, with image", "A vision call — costs more than a text-only one."],
  ["practice-explain", "Explain a practice mistake", "Why an MCQ or true/false answer was wrong."],
  ["practice-hint", "Hint before answering", "One of up to three escalating hints on a practice question the student hasn't answered yet."],
  ["practice-qna", "Ask about a practice solution", "One answer to a student's question about a step of a practice question's solution."],
  ["student-video", "Short AI video for a student", "One short video a student asks for from a lecture or AI video: the script and its voice."],
  ["practice-similar", "Generate similar questions", "A fresh set of similar practice questions from one question."],
  ["practice-grade-written", "Grade a written practice answer", "One written answer, marked against its rubric."],
  ["practice-exam-grade-written", "Grade a written answer in a practice exam", "Same grading, run per answer when a custom practice exam is submitted."],
  ["practice-exam-insight", "AI insight on a practice exam result", "A short coaching note a student can request after finishing a custom practice exam."],
  ["lecture-summarize", "Summarize lecture notes into key points", "Cached and shared once generated — billed only to whoever triggers it."],
  ["lecture-attachment-summary", "Summarize a lecture's attachments", "A prose summary of a lecture's attached PDFs/Word docs/slides."],
  ["pora-dhora", "Oral Quiz: one teacher turn", "One AI teacher turn in Oral Quiz. Only charged when Oral Quiz has no free daily questions set; otherwise it's billed per question answered."],
  ["ai-tutor", "AI Tutoring: one tutor turn", "One AI tutor turn (or one marked part of a creative question) in AI Tutoring. Only charged when AI Tutoring has no free daily questions set; otherwise it's billed per question answered."],
  ["doc-chat", "Course chat: one answer", "One answer in \"Ask this lecture\" / \"Ask your course\". Only charged when course chat has no daily question limit."],
  ["study-plan", "Generate a study plan", "Unless \"Free study plans\" above is on."],
];

// The archive's own equivalents — priced separately since the archive is a
// shared pool across every batch's own door (batch: null), not any one
// batch's own content. Each is gated per batch (BatchDetail.jsx's
// archiveAiAssist/archiveStudyPlan/archiveExamInsight toggles) before it
// ever reaches this cost. Keys must match backend/ai/featureCosts.js's
// FEATURE_COST_KEYS exactly, same as FEATURE_COSTS above.
const ARCHIVE_FEATURE_COSTS = [
  ["archive-explain", "Explain a mistake", "Why an MCQ or true/false answer was wrong, for a question from the public archive."],
  ["archive-hint", "Hint before answering", "One of up to three escalating hints on an archive question the student hasn't answered yet."],
  ["archive-grade-written", "Grade a written practice answer", "One written answer to an archive question, marked against its rubric."],
  ["archive-similar", "Generate similar questions", "A fresh set of similar questions from one archive question."],
  ["archive-exam-grade-written", "Grade a written answer in a practice exam", "Same grading, run per answer when an archive practice exam is submitted."],
  ["archive-exam-insight", "AI insight on a practice exam result", "A short coaching note after finishing an archive practice exam."],
  ["archive-study-plan", "Generate a study plan", "A student's archive-wide weak-topic data turned into a scheduled plan."],
];

export default function Settings() {
  const { me } = useOutletContext();
  const dispatch = useDispatch();
  const ui = useSelector((s) => s.ui);
  const canManageAi = ["owner", "admin"].includes(me.role);
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "appearance");

  // Same tab shape/gating every other page uses (see DoubtQueue) — each
  // tab is untouched from its old stacked-section form, still fully
  // gated per role (TeacherLocked still renders inside a tab exactly
  // like it did inline before, so nobody loses the "why can't I see
  // this" explanation), just one visible at a time instead of one long
  // scroll of five independent sections.
  const TABS = [
    ["appearance", "Appearance", Palette],
    ["institution", "Institution", School],
    ["grading", "Grading & pay", PenLine],
    ["referrals", "Referrals", Gift],
    ["studentApp", "Student app", Building2],
    ["seo", "SEO", Search],
    ["ai", "AI", Sparkles],
    ["notifications", "Notifications", Bell],
    ["payments", "Payment gateways", Wallet],
    ["connections", "Connections", Plug],
    ["data", "Data", Database],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="row-tight" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([value, label, Icon]) => (
          <button
            key={value}
            className={`pill pill-btn row-tight${tab === value ? " pill-on" : ""}`}
            style={{ gap: 5 }}
            onClick={() => setTab(value)}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      <div className="stack" style={{ gap: 16 }}>
        {tab === "appearance" && <Appearance ui={ui} dispatch={dispatch} />}
        {tab === "institution" && (canManageAi ? <InstitutionSettings /> : <TeacherLocked what="Institution settings" />)}
        {tab === "grading" && (canManageAi ? <><GradingSettings /><TeamPaySettings /></> : <TeacherLocked what="Grading settings" />)}
        {tab === "referrals" && (canManageAi ? <ReferralSettings /> : <TeacherLocked what="Referral settings" />)}
        {tab === "studentApp" && (canManageAi ? <StudentBranding /> : <TeacherLocked what="Student app branding" />)}
        {tab === "seo" && (canManageAi ? <SeoSettings /> : <TeacherLocked what="SEO settings" />)}
        {tab === "ai" && (canManageAi ? <AiSection /> : <TeacherLocked what="AI settings" />)}
        {tab === "notifications" && (canManageAi ? <NotificationSettings /> : <TeacherLocked what="Notification settings" />)}
        {/* Performance has its own page now; old links still land there. */}
        {tab === "performance" && <Navigate to="/performance" replace />}
        {/* Owner-only, not owner+admin — matches the backend route, which
            gates PUT /settings/payment/:provider to allow("owner") alone,
            the same restriction the app gives deleting a staff user. An
            admin used to just see nothing here with no explanation at all,
            which read exactly like the feature had been removed rather
            than restricted. */}
        {tab === "payments" && (me.role === "owner" ? <PaymentGateways /> : <TeacherLocked what="Payment gateways" by="the owner" />)}
        {tab === "connections" && (me.role === "owner" ? <Connections /> : <TeacherLocked what="Connections" by="the owner" />)}
        {tab === "data" && (me.role === "owner" ? <DataCleanup /> : <TeacherLocked what="Data clean-up" by="the owner" />)}
      </div>
    </div>
  );
}

// Old records that grow fast (one per AI call, chat, campaign send or
// caption line). Owner-only; deleting can't be undone.
const CLEANUP_HINT = {
  aiUsage: "One per AI call by any student. The daily limits only look at the last 24 hours; older entries are only history for the usage charts.",
  chatThreads: "Students' course chat conversations, by when they were last used.",
  practiceQna: "Students' follow-up questions on practice answers. Deleting one also resets that question's follow-up limit.",
  campaignDeliveries: "One per student per campaign or automation message. Campaign totals stay on the campaign.",
  liveCaptions: "Caption lines from in-app live classes. Only used to write class notes.",
};

function DataCleanup() {
  const confirm = useConfirm();
  const { data, isLoading, error } = useGetCleanupQuery();
  const [run, { isLoading: running }] = useRunCleanupMutation();
  const [ages, setAges] = useState({});
  const [done, setDone] = useState({});
  if (isLoading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  const ageOf = (kind) => ages[kind] || 90;
  const wipe = async (row) => {
    const days = ageOf(row.kind);
    if (!(await confirm({
      title: `Delete old ${row.label.toLowerCase()}?`,
      body: `Everything older than ${days} days is deleted for good. This can't be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    }))) return;
    try {
      const res = await run({ kind: row.kind, days }).unwrap();
      setDone((d) => ({ ...d, [row.kind]: `${res.deleted.toLocaleString()} deleted.` }));
    } catch (e) {
      setDone((d) => ({ ...d, [row.kind]: e?.data?.message || "Couldn't delete." }));
    }
  };
  return (
    <div className="card stack">
      <div>
        <h2 style={{ fontSize: 16 }}>Clean up old records</h2>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          These grow quickly on a busy site. Courses, results, payments and students are never touched here.
        </p>
      </div>
      {data.kinds.map((row) => (
        <div key={row.kind} className="row spread" style={{ padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap", gap: 10 }}>
          <div className="stack" style={{ gap: 2, flex: "1 1 280px" }}>
            <strong style={{ fontSize: 14 }}>{row.label}</strong>
            <span className="muted small tnum">
              About {row.count.toLocaleString()} record{row.count === 1 ? "" : "s"}
              {row.oldest ? ` · oldest ${new Date(row.oldest).toLocaleDateString()}` : ""}
            </span>
            <span className="hint">{CLEANUP_HINT[row.kind]}</span>
            {done[row.kind] && <span className="small">{done[row.kind]}</span>}
          </div>
          <div className="row-tight">
            <select className="select" value={ageOf(row.kind)} onChange={(e) => setAges((a) => ({ ...a, [row.kind]: Number(e.target.value) }))}>
              {data.ages.map((d) => <option key={d} value={d}>Older than {d} days</option>)}
            </select>
            <button className="btn btn-danger" disabled={running || row.count === 0} onClick={() => wipe(row)}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Appearance({ ui, dispatch, team = false }) {
  return (
    <div className="card stack">
      <div className="row-tight"><Palette size={17} className="muted" /><h2>Appearance</h2></div>

      <div className="field">
        <span className="label">Theme</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {themeNames.map((name) => {
            const swatch = themes[name][ui.mode === "dark" ? "dark" : "light"];
            return (
              <button
                key={name}
                className="row-tight"
                onClick={() => dispatch(setTheme(name))}
                style={{
                  padding: "7px 12px 7px 8px",
                  borderRadius: 20,
                  border: ui.theme === name ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  font: "inherit",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 16, height: 16, borderRadius: 5,
                    background: swatch.primary,
                    outline: `2px solid ${swatch.accent}`,
                    outlineOffset: -4,
                    display: "block",
                  }}
                />
                {themes[name].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
        <div className="field">
          <span className="label">Mode</span>
          <div className="row-tight">
            {[["light", Sun], ["dark", Moon], ["system", Monitor]].map(([mode, Icon]) => (
              <button
                key={mode}
                className={`pill pill-btn row-tight${ui.mode === mode ? " pill-on" : ""}`}
                style={{ gap: 5 }}
                onClick={() => dispatch(setMode(mode))}
              >
                <Icon size={12} />
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Navigation</span>
          <div className="row-tight">
            {[["sidebar", "Sidebar"], ["rail", "Icons only"], ["modern", "Modern"], ["dock", "Dock"], ["launcher", "Launcher"], ["glass", "Glass"]].filter(([v]) => !team || !["modern", "dock", "launcher"].includes(v)).map(([value, label]) => (
              <button
                key={value}
                className={`pill pill-btn${ui.layout === value ? " pill-on" : ""}`}
                onClick={() => dispatch(setLayout(value))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Every field a preset theme has (student-app/src/theme/tokens.js), for
// hand-picking instead of choosing a preset — one full palette per mode,
// since a color that reads fine in light mode can be illegible in dark.
const CUSTOM_THEME_FIELDS = [
  ["primary", "Primary", "Logo mark, bold banner fills"],
  ["primaryFg", "Primary foreground", "Text/icons drawn on top of Primary"],
  ["accent", "Accent", "Buttons, links, selected states"],
  ["bg", "Page background", ""],
  ["surface", "Card surface", ""],
  ["surfaceAlt", "Alt surface", "Chips, hover states, secondary panels"],
  ["border", "Border", ""],
  ["text", "Text", ""],
  ["textMuted", "Muted text", "Captions, secondary labels"],
];

// Light and dark palettes, plus an optional banner gradient for the
// gradient designs. "Start from" copies a preset's colours in to edit from;
// Reset goes back to Slate's.
function CustomThemeEditor({ value, onChange, gradientHint = "For the Soft, Y2K, Vaporwave and Aurora designs." }) {
  const palette = { light: {}, dark: {}, ...value };
  const gradient = { enabled: false, from: "#3B5BA5", via: "", to: "#B03A5E", angle: 135, ...(value?.gradient || {}) };
  const setField = (modeKey, field, color) =>
    onChange({ ...palette, [modeKey]: { ...palette[modeKey], [field]: color } });
  const setGradient = (patch) => onChange({ ...palette, gradient: { ...gradient, ...patch } });
  const startFrom = (name) => {
    if (!themes[name]) return;
    const pick = (mode) => Object.fromEntries(CUSTOM_THEME_FIELDS.map(([f]) => [f, themes[name][mode][f]]));
    onChange({ ...palette, light: pick("light"), dark: pick("dark") });
  };
  const stops = [gradient.from, gradient.via, gradient.to].filter(Boolean);
  const colorInput = (val, onPick) => (
    <input
      type="color"
      value={val || "#000000"}
      onChange={(e) => onPick(e.target.value)}
      style={{ width: 36, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
    />
  );

  return (
    <div className="stack" style={{ gap: 12, marginTop: 12 }}>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="small">Start from</span>
        <select className="select" style={{ maxWidth: 200 }} value="" onChange={(e) => startFrom(e.target.value)}>
          <option value="">Pick a theme…</option>
          {themeNames.map((name) => <option key={name} value={name}>{themes[name].label}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => startFrom("slate")}>Reset</button>
      </div>
      <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
        {["light", "dark"].map((modeKey) => (
          <div key={modeKey} className="stack" style={{ minWidth: 220 }}>
            <span className="label" style={{ textTransform: "capitalize" }}>{modeKey} mode</span>
            {CUSTOM_THEME_FIELDS.map(([field, label, hint]) => (
              <label key={field} className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="small" title={hint || undefined}>{label}</span>
                {colorInput(palette[modeKey]?.[field], (c) => setField(modeKey, field, c))}
              </label>
            ))}
          </div>
        ))}
        <div className="stack" style={{ minWidth: 220 }}>
          <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={Boolean(gradient.enabled)} onChange={(e) => setGradient({ enabled: e.target.checked })} />
            <span className="label" style={{ margin: 0 }}>Banner gradient</span>
          </label>
          <span className="hint" style={{ margin: 0 }}>{gradientHint}</span>
          {gradient.enabled && (
            <>
              <label className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}><span className="small">From</span>{colorInput(gradient.from, (c) => setGradient({ from: c }))}</label>
              <label className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="small">Middle (optional)</span>
                <span className="row-tight" style={{ gap: 6 }}>
                  {gradient.via && <button type="button" className="btn btn-sm btn-quiet" onClick={() => setGradient({ via: "" })}>None</button>}
                  {colorInput(gradient.via || gradient.from, (c) => setGradient({ via: c }))}
                </span>
              </label>
              <label className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}><span className="small">To</span>{colorInput(gradient.to, (c) => setGradient({ to: c }))}</label>
              <label className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}>
                <span className="small">Angle</span>
                <span className="row-tight" style={{ gap: 6 }}>
                  <input type="range" min={0} max={360} step={5} value={gradient.angle} onChange={(e) => setGradient({ angle: Number(e.target.value) })} />
                  <span className="small tnum" style={{ width: 34 }}>{gradient.angle}°</span>
                </span>
              </label>
              <div style={{ height: 44, borderRadius: 8, background: `linear-gradient(${gradient.angle}deg, ${stops.join(", ")})` }} aria-label="Gradient preview" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The admin's own appearance above is a personal, per-browser preference —
// this is the opposite: one setting, the same for every student, persisted
// on the server rather than in this admin's localStorage. Reuses the exact
// same theme set so the two panels can never drift into different palettes.
const STUDENT_APP_SECTIONS = [
  ["brand", "Brand & theme"],
  ["screens", "Layout & home"],
  ["notices", "Notices"],
  ["batch", "Batch pages"],
  ["video", "Video"],
  ["names", "Icons & names"],
  ["signup", "Sign-in & sign-up"],
  ["receipt", "Receipt"],
  ["live", "Live classroom"],
  ["mascot", "Mascot"],
];

// Countries students can use a phone number from, and the one the login and
// sign-up picker starts on.
const bare = { background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, font: "inherit" };

function PhoneCountries({ all, value, defaultCountry, onChange }) {
  const [q, setQ] = useState("");
  const byCode = new Map(all.map((c) => [c.code, c]));
  const needle = q.trim().toLowerCase().replace(/^\+/, "");
  const matches = needle
    ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle || c.dial.startsWith(needle))
    : all;
  const toggle = (code) => {
    if (value.includes(code)) {
      if (value.length === 1) return;
      const next = value.filter((c) => c !== code);
      onChange(next, next.includes(defaultCountry) ? defaultCountry : next[0]);
    } else {
      onChange([...value, code], defaultCountry);
    }
  };
  return (
    <div className="field">
      <span className="label">Phone number countries</span>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        Students pick one of these beside their number when they sign up or log in by phone. The starred one is the default.
      </p>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {value.map((code) => {
          const c = byCode.get(code);
          const isDefault = code === defaultCountry;
          return (
            <span key={code} className={`pill${isDefault ? " pill-on" : ""}`} style={{ gap: 6 }}>
              <button
                type="button"
                title={isDefault ? "Default" : "Make default"}
                onClick={() => onChange(value, code)}
                style={{ ...bare, display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Star size={12} fill={isDefault ? "currentColor" : "none"} />
                {c ? `${c.name} +${c.dial}` : code}
              </button>
              {value.length > 1 && (
                <button type="button" title="Remove" onClick={() => toggle(code)} style={bare}>×</button>
              )}
            </span>
          );
        })}
      </div>
      <input className="input" placeholder="Search countries or codes" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6, border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", maxWidth: 420 }}>
        {matches.map((c) => (
          <label key={c.code} className="row-tight" style={{ cursor: "pointer", padding: "3px 0" }}>
            <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} />
            <span className="small">{c.name}</span>
            <span className="small muted" style={{ marginLeft: "auto" }}>+{c.dial}</span>
          </label>
        ))}
        {!matches.length && <div className="small muted" style={{ padding: 6 }}>No match.</div>}
      </div>
    </div>
  );
}

function StudentBranding() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error: saveError }] = useUpdateSettingsMutation();
  const [uploadLogo, { isLoading: uploadingLogo, error: logoError }] = useUploadLogoMutation();
  const [uploadFavicon, { isLoading: uploadingFavicon, error: faviconError }] = useUploadFaviconMutation();
  const [uploadFeatureIcon, { isLoading: uploadingFeatureIcon, error: featureIconError }] = useUploadFeatureIconMutation();
  const [featureIconOpen, setFeatureIconOpen] = useState(null);
  // The tab grew long: its settings are split into sections, all saved
  // together by the one Save button.
  const [section, setSection] = useState("brand");

  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        siteName: settings.siteName,
        defaultCurrency: settings.defaultCurrency || "USD",
        studentUi: { ...settings.studentUi },
        studentAuth: { ...settings.studentAuth },
        receiptInfo: { ...settings.receiptInfo },
        liveRoom: { ...(settings.liveRoom || {}) },
      });
    }
  }, [settings, form]);

  if (isLoading || !form) return <div className="card"><Loading /></div>;

  const set = (patch) => setForm({ ...form, ...patch });
  const setStudentUi = (patch) => set({ studentUi: { ...form.studentUi, ...patch } });
  const setReceiptInfo = (patch) => set({ receiptInfo: { ...form.receiptInfo, ...patch } });
  const setLiveRoom = (patch) => set({ liveRoom: { ...form.liveRoom, ...patch } });

  const emailOk = settings.adapters.emailAvailable;
  const smsOk = settings.adapters.phoneAvailable;

  const identifierOptions = [
    { value: "email", label: "Email", available: emailOk },
    { value: "phone", label: "Phone", available: smsOk },
    { value: "both", label: "Both", available: emailOk && smsOk },
  ];
  // The whole studentAuth goes back on save, so picking a method keeps the rest.
  const pickIdentifier = (identifier) => set({ studentAuth: { ...form.studentAuth, identifier } });

  return (
    <div className="card stack">
      <div className="row-tight"><Building2 size={17} className="muted" /><h2>Student app</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        What every student sees. Set once here — not a per-person preference
        like your own appearance above.
      </p>

      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        {STUDENT_APP_SECTIONS.map(([value, label]) => (
          <button key={value} className={`pill pill-btn${section === value ? " pill-on" : ""}`} onClick={() => setSection(value)}>
            {label}
          </button>
        ))}
      </div>

      {section === "brand" && (
        <>
      <Field label="Platform name">
        <input
          className="input"
          value={form.siteName}
          onChange={(e) => set({ siteName: e.target.value })}
        />
      </Field>

      <Field
        label="Default currency"
        hint="Which gateway a checkout looks for when nothing else picks a currency — AI-credit purchases always use this one. Must match a currency at least one enabled payment gateway accepts (e.g. BDT for bKash, USD for Stripe)."
      >
        <input
          className="input"
          value={form.defaultCurrency}
          onChange={(e) => set({ defaultCurrency: e.target.value.toUpperCase() })}
          maxLength={3}
          style={{ width: 90, textTransform: "uppercase" }}
        />
      </Field>

      <div className="field">
        <span className="label">Logo</span>
        <div className="row-tight">
          {settings.logo ? (
            <img src={settings.logo} alt="" style={{ height: 36, borderRadius: 6 }} />
          ) : (
            <span className="muted small">No logo uploaded.</span>
          )}
          <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer" }}>
            <UploadCloud size={13} /> {uploadingLogo ? "Uploading" : "Upload"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
              }}
            />
          </label>
        </div>
        {logoError && <ErrorNote error={logoError} />}
      </div>

      <div className="field">
        <span className="label">Favicon</span>
        <div className="row-tight">
          {settings.favicon ? (
            <img src={settings.favicon} alt="" style={{ height: 24, width: 24, borderRadius: 5 }} />
          ) : (
            <span className="muted small">Using the default icon.</span>
          )}
          <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer" }}>
            <UploadCloud size={13} /> {uploadingFavicon ? "Uploading" : "Upload"}
            <input
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon,.ico"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFavicon(file);
              }}
            />
          </label>
        </div>
        <span className="hint">PNG or ICO. Shown in the browser tab for both the admin panel and the student app.</span>
        {faviconError && <ErrorNote error={faviconError} />}
      </div>

      <QuickBrand studentUi={form.studentUi} logo={settings.logo} siteName={form.siteName} onApply={(patch) => setStudentUi(patch)} />

      <EmailLook studentUi={form.studentUi} siteName={form.siteName} />

      <div className="field">
        <span className="label">Theme</span>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {themeNames.map((name) => {
            const swatch = themes[name][form.studentUi.mode === "dark" ? "dark" : "light"];
            return (
              <button
                key={name}
                className="row-tight"
                onClick={() => setStudentUi({ theme: name })}
                style={{
                  padding: "7px 12px 7px 8px",
                  borderRadius: 20,
                  border: form.studentUi.theme === name ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  font: "inherit",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 16, height: 16, borderRadius: 5,
                    background: swatch.primary,
                    outline: `2px solid ${swatch.accent}`,
                    outlineOffset: -4,
                    display: "block",
                  }}
                />
                {themes[name].label}
              </button>
            );
          })}
          <button
            className="row-tight"
            // Switching to custom starts from the theme picked until now,
            // unless the custom colours were already edited (kept as they are).
            onClick={() => {
              if (form.studentUi.theme === "custom") return;
              const from = themes[form.studentUi.theme];
              const pick = (src, mode) => Object.fromEntries(CUSTOM_THEME_FIELDS.map(([f]) => [f, String(src?.[mode]?.[f] || "").toUpperCase()]));
              const current = form.studentUi.customTheme;
              const untouched = JSON.stringify([pick(current, "light"), pick(current, "dark")]) === JSON.stringify([pick(themes.slate, "light"), pick(themes.slate, "dark")]);
              setStudentUi({
                theme: "custom",
                ...(from && untouched ? { customTheme: { ...(current || {}), light: pick(from, "light"), dark: pick(from, "dark") } } : {}),
              });
            }}
            style={{
              padding: "7px 12px 7px 8px",
              borderRadius: 20,
              border: form.studentUi.theme === "custom" ? "2px solid var(--accent)" : "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              font: "inherit",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 16, height: 16, borderRadius: 5,
                background: "conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)",
                display: "block",
              }}
            />
            Custom
          </button>
        </div>

        {form.studentUi.theme === "custom" && (
          <CustomThemeEditor
            value={form.studentUi.customTheme}
            onChange={(patch) => setStudentUi({ customTheme: patch })}
          />
        )}
      </div>

      <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
        <div className="field">
          <span className="label">Default mode</span>
          <div className="row-tight">
            {[["light", Sun], ["dark", Moon], ["system", Monitor]].map(([mode, Icon]) => (
              <button
                key={mode}
                className={`pill pill-btn row-tight${form.studentUi.mode === mode ? " pill-on" : ""}`}
                style={{ gap: 5 }}
                onClick={() => setStudentUi({ mode })}
              >
                <Icon size={12} />
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <label className="row-tight" style={{ cursor: "pointer", alignSelf: "flex-end", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={form.studentUi.allowModeOverride}
            onChange={(e) => setStudentUi({ allowModeOverride: e.target.checked })}
          />
          <span className="small">Students can switch light/dark themselves</span>
        </label>
      </div>

      <div className="field">
        <span className="label">Fonts</span>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <Field label="Heading font">
            <input
              className="input"
              placeholder="Design default"
              value={form.studentUi.fonts?.heading || ""}
              onChange={(e) => setStudentUi({ fonts: { ...form.studentUi.fonts, heading: e.target.value || null } })}
            />
          </Field>
          <Field label="Body font">
            <input
              className="input"
              placeholder="Design default"
              value={form.studentUi.fonts?.body || ""}
              onChange={(e) => setStudentUi({ fonts: { ...form.studentUi.fonts, body: e.target.value || null } })}
            />
          </Field>
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Type the exact Google Fonts family name — case-sensitive, e.g.
          "Poppins", "Playfair Display", "Noto Serif Bengali", "Hind
          Siliguri", "Baloo Da". Loaded live from Google Fonts, so Bangla and
          most other scripts work the same as Latin. Leave either blank to
          keep the font the Design above already sets for it.
        </p>
      </div>

        </>
      )}

      {section === "screens" && (
        <>
      <div className="field">
        <span className="label">Layout</span>
        <div className="row-tight">
          {[["app", "App", Smartphone], ["web", "Web", LayoutDashboard], ["adaptive", "Adaptive", MonitorSmartphone]].map(([value, label, Icon]) => (
            <button
              key={value}
              className={`pill pill-btn row-tight${form.studentUi.layout === value ? " pill-on" : ""}`}
              style={{ gap: 5 }}
              onClick={() => setStudentUi({ layout: value })}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          App: bottom navigation, one screen at a time, on every device. Web: a
          sidebar, more visible at once, on every device. Adaptive: sidebar on
          a wide screen, bottom navigation on a narrow one — picked per visit,
          not fixed for everyone.
        </p>
      </div>

      <div className="field">
        <span className="label">Design</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["panel", "Panel", Sparkles],
            ["editorial", "Editorial", BookOpen],
            ["mono", "Mono", Terminal],
            ["soft", "Soft", Heart],
            ["compact", "Compact", Rows3],
            ["classic", "Classic", ScrollText],
            ["y2k", "Y2K", Gem],
            ["neon", "Neon", Zap],
            ["vaporwave", "Vaporwave", Waves],
            ["pixel", "Pixel", Gamepad2],
            ["aurora", "Aurora", Rainbow],
            ["depth", "Depth", Layers],
            ["sketch", "Sketch", PenLine],
            ["khata", "Khata", NotebookPen],
            ["swiss", "Swiss", Grid3x3],
          ].map(([value, label, Icon]) => (
            <button
              key={value}
              className={`pill pill-btn row-tight${form.studentUi.design === value ? " pill-on" : ""}`}
              style={{ gap: 5 }}
              onClick={() => setStudentUi({ design: value })}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Panel: rounded cards, bold sans throughout, energetic. Editorial:
          serif headings, hairline rules, restrained color — reads like an
          exam paper. Mono: monospace, square corners, dense. Soft: pastel,
          heavily rounded, friendly. Compact: tight system sans, built to
          show more per screen. Classic: formal serif, sharp corners, a
          printed-prospectus feel. Y2K: bubbly rounded sans, glossy pastel
          gradients. Neon: dark, monospace, glowing accents — best paired
          with a dark-friendly theme below. Vaporwave: retro-futuristic
          sunset gradients, rounded glassy cards. Pixel: square corners,
          8-bit display headings, arcade-UI borders. Aurora: gradient
          banner, circular gradient-ring badges, glossy rounded cards.
          Depth: same as Panel, but every card lifts off the page with a
          soft shadow instead of a hairline border. Sketch: every card and button drawn in a rough
          pen line, handwritten headings, hatched banners. Khata: an exercise
          notebook — ruled paper, taped paper cards a little crooked, sticky
          notes, handwriting. Swiss: a poster — heavy rules instead of boxes, tight bold type,
          uppercase labels. Independent of layout
          above — any design works with any layout, and all of them use
          whichever theme below is selected.
        </p>
      </div>

      <div className="field">
        <span className="label">Home screen layout</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["list", "List (current)"],
            ["richCards", "Rich cards"],
            ["heroList", "Hero + list"],
            ["editorial", "Editorial"],
            ["bento", "Bento"],
            ["today", "Today"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${form.studentUi.dashboardStyle === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ dashboardStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The screen a student lands on first, listing every batch they're
          enrolled in. List keeps what's there today. Bento: tiles for the
          lecture to pick up, the next exam and live class, the streak, then
          the batches. Today: a timeline of today's classes, exams and tutor
          tasks across every batch, with the batches beside it.
        </p>
      </div>

      <div className="field">
        <span className="label">Home screen position</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["left", "Left"],
            ["center", "Centre"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.homeAlign || "left") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ homeAlign: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Where the main pages sit on a wide screen (web layout, or adaptive
          on a wide screen): against the left edge or in the middle. Applies
          to the home screen, the lectures list, a lecture, the exams list,
          results, one result, plans, practice, learn, the archive, doubts and
          assignments. Pages
          such as one exam or the notices always stay in the middle.
        </p>
      </div>

      <div className="field">
        <span className="label">Course catalogue</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["classic", "Classic"],
            ["photoLogo", "Photo + logo"],
            ["list", "Compact list"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.catalogueStyle || "classic") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ catalogueStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The catalogue on the student home screen. Classic: program photo
          banner, then logo cards. Photo + logo: the program name in large
          type, and each card shows the program photo with the logo on top.
          Compact list: the program name, then one short row per batch.
        </p>
      </div>

      <div className="field">
        <span className="label">Compact top area on mobile</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [true, "On"],
            [false, "Off"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${(form.studentUi.compactMobile !== false) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ compactMobile: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          On a phone, home notices and the batch banner are made smaller (the
          notice picture scales with the screen and hides on short screens),
          so students see the things to tap without scrolling.
        </p>
      </div>

      <div className="field">
        <span className="label">Compact top area on bigger screens</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [true, "On"],
            [false, "Off"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${(form.studentUi.compactShort !== false) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ compactShort: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The same on a tablet or a laptop whose screen is short (up to 820
          pixels tall), where notices and the batch banner would otherwise
          fill the first screen.
        </p>
      </div>
        </>
      )}
      {section === "notices" && (
        <>
      <div className="field">
        <span className="label">Notices on the home page</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[[true, "On"], [false, "Off"]].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${(form.studentUi.homeNotices !== false) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ homeNotices: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Off hides general notices from students' home page. Batch notices
          still show in each batch's Notice Central.
        </p>
      </div>

      <div className="field">
        <span className="label">Notice style</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[["cards", "Cards"], ["banner", "Banner"], ["spotlight", "Spotlight", true], ["rail", "Rail", true]].map(([value, label, webOnly]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.noticeStyle || "cards") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ noticeStyle: value })}
            >
              {label}{webOnly && <span className="small muted" style={{ marginLeft: 6 }}>web</span>}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Cards: the carousel of cards. Banner: one slim bar. Spotlight: one
          big notice with the next three beside it. Rail: notices in a column
          beside the batches. Spotlight and
          Rail show on wide screens only; on phones they show as Cards.
        </p>
      </div>

      <div className="field">
        <span className="label">Notices on phones (Cards style only)</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [false, "Cards"],
            [true, "Slim strip"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${Boolean(form.studentUi.noticeStrip) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ noticeStrip: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Slim strip shows home notices as one rotating line; tapping it opens
          the notice. Notices marked Featured still show as full cards. Web
          and tablet always show cards.
        </p>
      </div>
        </>
      )}
      {section === "batch" && (
        <>
      <div className="field">
        <span className="label">Batch page layout</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["list", "List (current)"],
            ["iconGrid", "Icon grid"],
            ["cardGrid", "Card grid"],
            ["bento", "Bento"],
            ["tabs", "Tabs"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${form.studentUi.batchHomeStyle === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ batchHomeStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          How a student sees lectures/practice/exams/doubts laid out once
          they're inside one specific batch. List keeps what's there today.
          Bento and Tabs lead with what to do next (the lecture to pick up,
          the next exam or live class). Tabs splits the sections into Learn,
          Test, AI and More.
        </p>
      </div>

      <div className="field">
        <span className="label">Teachers on batch home (mobile)</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [true, "On"],
            [false, "Off"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${(form.studentUi.mobileTeachers !== false) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ mobileTeachers: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          On a phone, show the batch's teachers on its home screen. Off saves
          space; wider screens always show them.
        </p>
      </div>

      <div className="field">
        <span className="label">Batch breadcrumb style</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["glass", "Glass (current)"],
            ["solid", "Solid"],
            ["minimal", "Minimal"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${form.studentUi.batchContextStyle === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ batchContextStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The small "Batch — Page" strip shown above lectures/exams/practice
          once a student is inside one specific batch. Glass: a translucent,
          blurred pill with a fixed accent color, independent of the theme
          below. Solid: an opaque card using the active theme's own accent,
          with the batch's icon or uploaded logo given real room instead of
          floating small inside a ring. Minimal: plain breadcrumb text, no
          card or icon at all — closest fit for a restrained design like
          Editorial or Mono.
        </p>
      </div>

      <div className="field">
        <span className="label">Lecture list layout</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["simple", "Simple (current)"],
            ["hierarchical", "Hierarchical"],
            ["hierarchicalCards", "Hierarchical (cards)"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${form.studentUi.lectureListStyle === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ lectureListStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Simple is one flat list of lectures. Both Hierarchical options group
          them by chapter, then topic, each with its own progress and a
          collapsible section — they only differ in row style: a flat divided
          list ("Hierarchical") vs. each lecture in its own bordered card
          ("Hierarchical (cards)").
        </p>
      </div>

      <div className="field">
        <span className="label">Plan page</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["classic", "Classic (current)"],
            ["columns", "Columns"],
            ["aurora", "Aurora"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.planStyle || "classic") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ planStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Where students pick a plan and pay. Classic: one narrow list. Columns:
          a pricing table with plans side by side and the best value plan
          marked. Aurora: full screen, frosted glass cards over slow light in
          your theme colour, with the total and pay button beside the plans.
          Columns and Aurora fit themselves to phones and wide screens.
        </p>
      </div>

      <div className="field">
        <span className="label">Leaderboard layout</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["podium", "Podium (current)"],
            ["scoreboard", "Scoreboard"],
            ["spotlight", "Spotlight"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.leaderboardStyle || "podium") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ leaderboardStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Podium: the top three on a podium, the rest in a list. Scoreboard: one
          ranked table with a score bar per student. Spotlight: the student's own
          rank first, then the top ten as score cards with rings.
        </p>
      </div>

      <div className="field">
        <span className="label">My tutor page</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["console", "AI console"],
            ["classic", "Classic"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.tutorStyle || "console") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ tutorStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          AI console: a dark robotic console with an animated tutor robot that
          types out today's briefing, a reactor ring for the day's progress and
          the plan as a mission queue. Classic: plain cards.
        </p>
      </div>
        </>
      )}
      {section === "video" && (
        <>
      <div className="field">
        <span className="label">Name over videos</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["all", "Every video"],
            ["app", "Only videos the app plays"],
            ["off", "Off"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.videoWatermark || "all") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ videoWatermark: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The student's name and phone (or email) drift faintly over videos,
          so a screen recording shows whose account it came from. "Only
          videos the app plays" covers uploaded files and AI video lessons
          and leaves Bunny, Vimeo and YouTube videos to their own download
          protection.
        </p>
      </div>

      <div className="field">
        <span className="label">Video player</span>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <span className="hint" style={{ minWidth: 90 }}>Colour</span>
            <button className={`pill pill-btn${!form.studentUi.videoPlayer?.accent ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ videoPlayer: { ...form.studentUi.videoPlayer, accent: "" } })}>
              Brand colour
            </button>
            <label className={`pill pill-btn row-tight${form.studentUi.videoPlayer?.accent ? " pill-on" : ""}`} style={{ gap: 6 }}>
              <input type="color" value={form.studentUi.videoPlayer?.accent || "#3B5BA5"}
                onChange={(e) => setStudentUi({ videoPlayer: { ...form.studentUi.videoPlayer, accent: e.target.value } })}
                style={{ width: 22, height: 22, border: "none", padding: 0, background: "none" }} />
              Custom
            </label>
          </div>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <span className="hint" style={{ minWidth: 90 }}>Skip buttons</span>
            {[5, 10, 15, 30].map((n) => (
              <button key={n} className={`pill pill-btn${(form.studentUi.videoPlayer?.skip || 10) === n ? " pill-on" : ""}`}
                onClick={() => setStudentUi({ videoPlayer: { ...form.studentUi.videoPlayer, skip: n } })}>
                {n} s
              </button>
            ))}
          </div>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            <span className="hint" style={{ minWidth: 90 }}>Starts in</span>
            {[["auto", "Auto quality"], ["best", "Best quality"]].map(([v, label]) => (
              <button key={v} className={`pill pill-btn${(form.studentUi.videoPlayer?.startQuality || "auto") === v ? " pill-on" : ""}`}
                onClick={() => setStudentUi({ videoPlayer: { ...form.studentUi.videoPlayer, startQuality: v } })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The app's own player, for uploaded and protected videos: speed and
          quality menus, skip buttons, double-tap to skip on phones, keyboard
          keys (space, ← →, F, M). "Best quality" starts protected videos in
          their highest quality; Auto follows the connection.
        </p>
      </div>

      <div className="field">
        <span className="label">Protected videos: one device at a time</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[[false, "Off"], [true, "On"]].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${Boolean(form.studentUi.videoOneDevice) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ videoOneDevice: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          When a student starts a protected video on a second phone or
          computer, it stops on the first one within about a minute. Stops
          one account being shared to watch at the same time.
        </p>
        <ProtectAllVideos />
      </div>

      <div className="field">
        <span className="label">Lock YouTube player</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [false, "Off"],
            [true, "On"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${Boolean(form.studentUi.youtubeLock) === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ youtubeLock: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          On: YouTube videos play with the app's own controls and a layer over
          the player, so students can't click YouTube's title, logo or "Watch
          on YouTube" links, or right-click the video. YouTube's own icons
          still show. This stops casual sharing only: the video ID is still in
          the page. Hiding YouTube's player controls is against YouTube's
          rules for embeds, so use unlisted videos on a separate channel. Use
          Bunny or Vimeo for videos that must be protected.
        </p>
      </div>
        </>
      )}
      {section === "mascot" && (
        <MascotSettings value={form.studentUi.mascot || {}} onChange={(patch) => setStudentUi({ mascot: { ...(form.studentUi.mascot || {}), ...patch } })} />
      )}

      {section === "names" && (
        <>
      <div className="field">
        <span className="label">Feature icons</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          The icons on a student's "Jump to" grid inside a batch. Leave any
          of these alone to keep the app's own default icon for it.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {JUMP_TO_FEATURES.map(([key, label, Default]) => {
            const current = form.studentUi.featureIcons?.[key];
            return (
              <div key={key}>
                <button
                  type="button"
                  className="card-quiet spread"
                  style={{ width: "100%", border: "none", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }}
                  onClick={() => setFeatureIconOpen(featureIconOpen === key ? null : key)}
                >
                  <div className="row-tight grow">
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {current ? <BatchIcon icon={current} size={16} /> : <Default size={16} />}
                    </div>
                    <span className="small">{label}</span>
                    {!current && <span className="muted small">Default</span>}
                  </div>
                  <span className="muted small">{featureIconOpen === key ? "Close" : "Change"}</span>
                </button>
                {featureIconOpen === key && (
                  <>
                    <IconPicker
                      currentIcon={current}
                      uploading={uploadingFeatureIcon}
                      // Default here means "no override at all" (undefined,
                      // falling back to this feature's own built-in icon
                      // above) — not any particular preset, since a
                      // GraduationCap override would just be one more
                      // override, not a way back to `current` being unset.
                      isDefault={!current}
                      onPickPreset={(value) =>
                        setStudentUi({
                          featureIcons: { ...form.studentUi.featureIcons, [key]: { kind: "preset", value } },
                        })
                      }
                      onReset={() =>
                        setStudentUi({
                          featureIcons: { ...form.studentUi.featureIcons, [key]: undefined },
                        })
                      }
                      onUpload={(file) =>
                      uploadFeatureIcon({ feature: key, file }).then((result) => {
                        // Without this, form never learns about the upload —
                        // it only mutates locally on preset picks (see
                        // onPickPreset above). The settings refetch this
                        // mutation triggers doesn't reach form either: the
                        // sync effect only runs once, on first load. Left
                        // alone, form keeps showing the old icon, and the
                        // next unrelated save in this page sends that stale
                        // value back to the server — silently overwriting
                        // the upload that just succeeded.
                        if (result.data) {
                          setStudentUi({
                            featureIcons: { ...form.studentUi.featureIcons, [key]: result.data.featureIcons[key] },
                          });
                        }
                      })
                    }
                    />
                    {featureIconError && <ErrorNote error={featureIconError} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">Feature names</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          The label under each tile on a student's "Jump to" grid. Leave any
          of these alone to keep the app's own default name for it.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {JUMP_TO_FEATURES.map(([key, label]) => {
            const current = form.studentUi.featureNames?.[key] || "";
            return (
              <div key={key} className="row-tight">
                <span className="small muted" style={{ width: 110, flexShrink: 0 }}>{label}</span>
                <input
                  className="input"
                  style={{ maxWidth: 220 }}
                  placeholder={label}
                  value={current}
                  onChange={(e) =>
                    setStudentUi({
                      featureNames: { ...form.studentUi.featureNames, [key]: e.target.value || undefined },
                    })
                  }
                />
                {current && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Reset to default"
                    onClick={() =>
                      setStudentUi({
                        featureNames: { ...form.studentUi.featureNames, [key]: undefined },
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">My progress level names</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          The title a student earns on their "My progress" page as they level
          up. Leave any of these empty to keep the default name.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {LEVEL_BANDS.map(([from, title], i) => {
            const names = form.studentUi.levelTitles || [];
            const current = names[i] || "";
            const to = LEVEL_BANDS[i + 1] ? LEVEL_BANDS[i + 1][0] - 1 : null;
            const setName = (value) => {
              const next = LEVEL_BANDS.map((_, k) => names[k] || "");
              next[i] = value;
              setStudentUi({ levelTitles: next });
            };
            return (
              <div key={from} className="row-tight">
                <span className="small muted" style={{ width: 110, flexShrink: 0 }}>
                  {to ? (to === from ? `Level ${from}` : `Levels ${from}–${to}`) : `Level ${from}+`}
                </span>
                <input className="input" style={{ maxWidth: 220 }} maxLength={24} placeholder={title} value={current} onChange={(e) => setName(e.target.value)} />
                {current && (
                  <button type="button" className="icon-btn" title="Reset to default" onClick={() => setName("")}>
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">Error messages</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          What students read when something goes wrong. Technical errors
          (server faults, database or AI provider replies) never reach them;
          they see the general message instead. Leave a box empty for the default.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {[
            ["general", "General", "Something went wrong. Please try again in a moment."],
            ["network", "No connection", "Can't reach the server. Check your internet connection and try again."],
          ].map(([key, label, placeholder]) => (
            <div key={key} className="row-tight">
              <span className="small muted" style={{ width: 110, flexShrink: 0 }}>{label}</span>
              <input
                className="input" maxLength={200} placeholder={placeholder}
                value={form.studentUi.errorMessages?.[key] || ""}
                onChange={(e) => setStudentUi({ errorMessages: { ...form.studentUi.errorMessages, [key]: e.target.value } })}
              />
            </div>
          ))}
        </div>
        <p className="hint" style={{ margin: "12px 0 6px" }}>
          Reword one message: when the message a student would see contains
          the first text, they see the second instead.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {(form.studentUi.errorMessages?.rules || []).map((r, i) => {
            const rules = form.studentUi.errorMessages?.rules || [];
            const setRule = (patch) =>
              setStudentUi({ errorMessages: { ...form.studentUi.errorMessages, rules: rules.map((x, k) => (k === i ? { ...x, ...patch } : x)) } });
            return (
              <div key={i} className="row-tight">
                <input className="input" maxLength={200} placeholder="When it contains… e.g. Too many codes" value={r.match || ""} onChange={(e) => setRule({ match: e.target.value })} />
                <input className="input" maxLength={200} placeholder="Show this instead" value={r.text || ""} onChange={(e) => setRule({ text: e.target.value })} />
                <button
                  type="button" className="icon-btn icon-btn-danger" title="Remove"
                  onClick={() => setStudentUi({ errorMessages: { ...form.studentUi.errorMessages, rules: rules.filter((_, k) => k !== i) } })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          <button
            type="button" className="btn btn-sm btn-quiet row-tight" style={{ alignSelf: "flex-start" }}
            onClick={() => setStudentUi({ errorMessages: { ...form.studentUi.errorMessages, rules: [...(form.studentUi.errorMessages?.rules || []), { match: "", text: "" }] } })}
          >
            <Plus size={13} /> Add a rewording
          </button>
        </div>
      </div>

      <div className="field">
        <span className="label">Archive hub icons</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          The icons on the archive's own internal hub (Browse & Practice,
          Study Plan, Build a practice exam, My Favorites) — one level
          inside a batch's "Archive" tile. Leave any of these alone to keep
          the app's own default icon for it.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {ARCHIVE_HUB_FEATURES.map(([key, label, Default]) => {
            const current = form.studentUi.featureIcons?.[key];
            return (
              <div key={key}>
                <button
                  type="button"
                  className="card-quiet spread"
                  style={{ width: "100%", border: "none", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }}
                  onClick={() => setFeatureIconOpen(featureIconOpen === key ? null : key)}
                >
                  <div className="row-tight grow">
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {current ? <BatchIcon icon={current} size={16} /> : <Default size={16} />}
                    </div>
                    <span className="small">{label}</span>
                    {!current && <span className="muted small">Default</span>}
                  </div>
                  <span className="muted small">{featureIconOpen === key ? "Close" : "Change"}</span>
                </button>
                {featureIconOpen === key && (
                  <>
                    <IconPicker
                      currentIcon={current}
                      uploading={uploadingFeatureIcon}
                      isDefault={!current}
                      onPickPreset={(value) =>
                        setStudentUi({
                          featureIcons: { ...form.studentUi.featureIcons, [key]: { kind: "preset", value } },
                        })
                      }
                      onReset={() =>
                        setStudentUi({
                          featureIcons: { ...form.studentUi.featureIcons, [key]: undefined },
                        })
                      }
                      onUpload={(file) =>
                      uploadFeatureIcon({ feature: key, file }).then((result) => {
                        if (result.data) {
                          setStudentUi({
                            featureIcons: { ...form.studentUi.featureIcons, [key]: result.data.featureIcons[key] },
                          });
                        }
                      })
                    }
                    />
                    {featureIconError && <ErrorNote error={featureIconError} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="label">Archive hub names</span>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          The label under each tile on the archive's own internal hub. Leave
          any of these alone to keep the app's own default name for it.
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {ARCHIVE_HUB_FEATURES.map(([key, label]) => {
            const current = form.studentUi.featureNames?.[key] || "";
            return (
              <div key={key} className="row-tight">
                <span className="small muted" style={{ width: 150, flexShrink: 0 }}>{label}</span>
                <input
                  className="input"
                  style={{ maxWidth: 220 }}
                  placeholder={label}
                  value={current}
                  onChange={(e) =>
                    setStudentUi({
                      featureNames: { ...form.studentUi.featureNames, [key]: e.target.value || undefined },
                    })
                  }
                />
                {current && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Reset to default"
                    onClick={() =>
                      setStudentUi({
                        featureNames: { ...form.studentUi.featureNames, [key]: undefined },
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

        </>
      )}

      {section === "signup" && (
        <>
      <div className="field">
        <span className="label">Sign-in page design</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            ["hero", "Colour band"],
            ["split", "Split"],
            ["minimal", "Minimal"],
            ["glass", "Glass"],
            ["bold", "Bold"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`pill pill-btn${(form.studentUi.authStyle || "hero") === value ? " pill-on" : ""}`}
              onClick={() => setStudentUi({ authStyle: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          The look of the sign-in, sign-up and reset-password pages. Colour band is the original. Split puts your
          name beside the form on a wide screen; Minimal is just the logo and form; Glass floats a frosted card on a
          soft gradient; Bold fills the page with your colour. All follow your theme colours.
        </p>
      </div>

      <Field label="Sign-in page picture" hint="Optional. Shown behind the colour on the sign-in pages, tinted with your theme colour so text stays readable. Upload one or make one with AI.">
        <ImagePicker
          value={null}
          url={form.studentUi.authImage || null}
          folder="branding"
          label="Picture"
          ai="picture"
          aiPurpose="auth"
          onChange={(id, url) => setStudentUi({ authImage: url || null })}
        />
        {form.studentUi.authImage && (
          <button type="button" className="btn btn-sm btn-quiet" style={{ marginTop: 6 }} onClick={() => setStudentUi({ authImage: null })}>
            Remove picture, use the default look
          </button>
        )}
      </Field>

      <div className="field">
        <span className="label">Sign-up method</span>
        <div className="row-tight">
          {identifierOptions.map(({ value, label, available }) => (
            <button
              key={value}
              disabled={!available}
              className={`pill pill-btn${form.studentAuth.identifier === value ? " pill-on" : ""}`}
              title={available ? undefined : "Not configured yet — see the environment variables for this channel"}
              onClick={() => pickIdentifier(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {settings.adapters.devFallback && (
          <div className="banner row-tight" style={{ marginTop: 8 }}>
            <span className="muted small">
              Running outside production — verification codes show up right in
              the sign-up screen instead of being emailed or texted, so every
              option above works for testing with no provider configured.
              Real delivery still needs SMTP_* or SMS_PROVIDER set before this
              goes live.
            </span>
          </div>
        )}
        {!emailOk && !smsOk && (
          <div className="banner banner-warn row-tight" style={{ marginTop: 8 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>
              Neither email nor SMS is configured yet, so students cannot sign up
              until one is. Set SMTP_* or SMS_PROVIDER in the environment.
            </span>
          </div>
        )}
      </div>

      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.studentAuth.codeLogin !== false}
          onChange={(e) => set({ studentAuth: { ...form.studentAuth, codeLogin: e.target.checked } })}
        />
        <span className="small">Students can log in with a code instead of a password</span>
      </label>

      <PhoneCountries
        all={settings.phoneCountries || []}
        value={form.studentAuth.countries?.length ? form.studentAuth.countries : ["BD"]}
        defaultCountry={form.studentAuth.defaultCountry || "BD"}
        onChange={(countries, defaultCountry) => set({ studentAuth: { ...form.studentAuth, countries, defaultCountry } })}
      />

        </>
      )}

      {section === "live" && (
        <>
          <LiveRoomBranding value={form.liveRoom} set={setLiveRoom} platformLogo={settings.logo} />
          <LiveTeacherRules value={form.liveRoom} set={setLiveRoom} />
        </>
      )}

      {section === "receipt" && (
        <>
      <div className="row-tight"><Receipt size={17} className="muted" /><h2>Receipt details</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        Printed on a student's purchase receipt. All optional — leave any of
        these blank and the receipt just skips that line.
      </p>

      <Field label="Legal / business name" hint="Falls back to the platform name above if left blank.">
        <input
          className="input"
          value={form.receiptInfo.legalName || ""}
          onChange={(e) => setReceiptInfo({ legalName: e.target.value })}
        />
      </Field>

      <Field label="Address">
        <input
          className="input"
          value={form.receiptInfo.address || ""}
          onChange={(e) => setReceiptInfo({ address: e.target.value })}
        />
      </Field>

      <Field label="Support email">
        <input
          className="input"
          type="email"
          value={form.receiptInfo.supportEmail || ""}
          onChange={(e) => setReceiptInfo({ supportEmail: e.target.value })}
        />
      </Field>

      <Field label="Support phone">
        <input
          className="input"
          value={form.receiptInfo.supportPhone || ""}
          onChange={(e) => setReceiptInfo({ supportPhone: e.target.value })}
        />
      </Field>

      <Field label="Tax / registration ID" hint="BIN, TIN, VAT number — whatever your institution's local requirement is.">
        <input
          className="input"
          value={form.receiptInfo.taxId || ""}
          onChange={(e) => setReceiptInfo({ taxId: e.target.value })}
        />
      </Field>

      <label className="row-tight">
        <input type="checkbox" checked={Boolean(form.receiptInfo.tax?.enabled)}
          onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, enabled: e.target.checked } })} />
        <span>Tax invoices (VAT, GST)</span>
      </label>
      {form.receiptInfo.tax?.enabled && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <Field label="Tax name">
            <input className="input" style={{ width: 100 }} value={form.receiptInfo.tax?.label ?? "VAT"}
              onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, label: e.target.value } })} />
          </Field>
          <Field label="Rate %" hint="Prices include it.">
            <input className="input tnum" type="number" min={0} max={100} step="0.01" style={{ width: 90 }} value={form.receiptInfo.tax?.rate ?? 0}
              onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, rate: Number(e.target.value) } })} />
          </Field>
          <Field label="Invoice prefix">
            <input className="input" style={{ width: 90 }} maxLength={12} value={form.receiptInfo.tax?.prefix ?? "INV"}
              onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "") } })} />
          </Field>
          <Field label="Financial year starts" hint="Numbers restart each year.">
            <select className="select" value={form.receiptInfo.tax?.yearStartMonth ?? 1}
              onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, yearStartMonth: Number(e.target.value) } })}>
              {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <label className="row-tight">
            <input type="checkbox" checked={Boolean(form.receiptInfo.tax?.gstSplit)}
              onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, gstSplit: e.target.checked } })} />
            <span>India GST: CGST + SGST or IGST by the student's state</span>
          </label>
          {form.receiptInfo.tax?.gstSplit && (
            <Field label="Your state" hint="Students give theirs in their profile.">
              <input className="input" style={{ width: 160 }} value={form.receiptInfo.tax?.homeState || ""}
                onChange={(e) => setReceiptInfo({ tax: { ...form.receiptInfo.tax, homeState: e.target.value } })} />
            </Field>
          )}
        </div>
      )}

        </>
      )}

      <ErrorNote error={saveError} />

      <button className="btn" style={{ alignSelf: "flex-start" }} disabled={saving} onClick={() => update(form)}>
        {saving ? "Saving" : "Save"}
      </button>
    </div>
  );
}

// The Spotlight and Split banners' text and button colours, for a course
// page custom theme. Each is automatic until set.
const BANNER_FIELDS = [
  ["text", "Banner text", "#FFFFFF"],
  ["button", "Button", "#FFFFFF"],
  ["buttonText", "Button text", "#14161A"],
];
function BannerColors({ value, onChange }) {
  const banner = { text: "", button: "", buttonText: "", ...(value || {}) };
  return (
    <div className="stack" style={{ gap: 8, marginTop: 12, minWidth: 220, maxWidth: 320 }}>
      <span className="label">Banner colours</span>
      <span className="hint" style={{ margin: 0 }}>The text and Enroll button on the Spotlight and Split banners. Auto picks colours that read on the banner.</span>
      {BANNER_FIELDS.map(([field, label, fallback]) => (
        <label key={field} className="row-tight" style={{ justifyContent: "space-between", gap: 8 }}>
          <span className="small">{label}</span>
          <span className="row-tight" style={{ gap: 6 }}>
            {banner[field]
              ? <button type="button" className="btn btn-sm btn-quiet" onClick={() => onChange({ ...banner, [field]: "" })}>Auto</button>
              : <span className="small muted">Auto</span>}
            <input
              type="color"
              value={banner[field] || fallback}
              onChange={(e) => onChange({ ...banner, [field]: e.target.value })}
              style={{ width: 36, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
            />
          </span>
        </label>
      ))}
    </div>
  );
}

// Settings → SEO → Course pages: the pages' own theme. "Same as the app"
// keeps the student app's theme; a preset or Custom replaces it on the
// course pages only (student app CoursePage.jsx). Design, mode and fonts
// still come from the student app.
function CourseThemePicker({ value, custom, appUi, onChange }) {
  const current = value || "app";
  const look = appUi?.mode === "dark" ? "dark" : "light";
  const pill = (on) => ({
    padding: "7px 12px 7px 8px",
    borderRadius: 20,
    border: on ? "2px solid var(--accent)" : "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    font: "inherit",
    fontSize: 12.5,
    cursor: "pointer",
  });
  const dot = (style) => <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 5, display: "block", ...style }} />;
  // Switching to Custom starts from the theme on screen until now (a preset
  // picked here, or the app's own), unless the custom colours were already
  // edited.
  const pickCustom = () => {
    if (current === "custom") return;
    const pick = (src, mode) => Object.fromEntries(CUSTOM_THEME_FIELDS.map(([f]) => [f, String(src?.[mode]?.[f] || "").toUpperCase()]));
    const untouched = JSON.stringify([pick(custom, "light"), pick(custom, "dark")]) === JSON.stringify([pick(themes.slate, "light"), pick(themes.slate, "dark")]);
    const from = current !== "app" ? themes[current] : appUi?.theme === "custom" ? appUi.customTheme : themes[appUi?.theme];
    onChange({
      courseTheme: "custom",
      ...(from && untouched ? { courseCustomTheme: { ...(custom || {}), light: pick(from, "light"), dark: pick(from, "dark"), ...(from.gradient ? { gradient: from.gradient } : {}) } } : {}),
    });
  };

  return (
    <div className="field">
      <span className="label">Theme</span>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="row-tight" style={pill(current === "app")} onClick={() => onChange({ courseTheme: "app" })}>
          {dot({ border: "2px dashed var(--border)" })}
          Same as the app
        </button>
        {themeNames.map((name) => {
          const swatch = themes[name][look];
          return (
            <button key={name} type="button" className="row-tight" style={pill(current === name)} onClick={() => onChange({ courseTheme: name })}>
              {dot({ background: swatch.primary, outline: `2px solid ${swatch.accent}`, outlineOffset: -4 })}
              {themes[name].label}
            </button>
          );
        })}
        <button type="button" className="row-tight" style={pill(current === "custom")} onClick={pickCustom}>
          {dot({ background: "conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)" })}
          Custom
        </button>
      </div>
      <span className="hint">
        {current === "app" ? "Course pages use the student app's theme." : "Only the course pages change; the student app keeps its own theme."}
      </span>
      {current === "custom" && (
        <>
          <CustomThemeEditor value={custom} onChange={(courseCustomTheme) => onChange({ courseCustomTheme })} gradientHint="Paints the Spotlight and Split banners. Off: they use the accent colour." />
          <BannerColors value={custom?.banner} onChange={(banner) => onChange({ courseCustomTheme: { ...(custom || {}), banner } })} />
        </>
      )}
    </div>
  );
}

// Meta tags for the public landing page (student-app's LandingPage.jsx) —
// what shows up in a search result and when the link is shared. Separate
// tab from Student app branding above since it's a distinct concern (search
// engines/social crawlers, not the student's own experience) and grows its
// own AI-assist step.
function SeoSettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error: saveError }] = useUpdateSettingsMutation();
  const [suggest, { isLoading: suggesting, error: suggestError }] = useSuggestSeoMetaMutation();
  const [context, setContext] = useState("");
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({ seo: { ...settings.seo, keywords: settings.seo?.keywords || [] } });
    }
  }, [settings, form]);

  if (isLoading || !form) return <div className="card"><Loading /></div>;

  const setSeo = (patch) => setForm({ seo: { ...form.seo, ...patch } });

  const runSuggest = async () => {
    if (!context.trim()) return;
    try {
      const result = await suggest({ context }).unwrap();
      setSeo({ metaTitle: result.metaTitle, metaDescription: result.metaDescription, keywords: result.keywords });
    } catch {
      // surfaced via suggestError below
    }
  };

  const titleLen = (form.seo.metaTitle || "").length;
  const descLen = (form.seo.metaDescription || "").length;

  return (
    <div className="card stack">
      <div className="row-tight"><Search size={17} className="muted" /><h2>SEO</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        Meta tags for the public landing page — what shows up in a search
        result and when the link is shared. All optional.
      </p>

      <div className="card-quiet stack" style={{ gap: 8 }}>
        <span className="label row-tight" style={{ gap: 5 }}><Wand2 size={13} /> AI draft</span>
        <div className="row-tight">
          <input
            className="input grow"
            placeholder="What does this institution teach/offer? e.g. HSC physics and chemistry coaching in Dhaka"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
          <button className="btn btn-sm" disabled={suggesting || !context.trim()} onClick={runSuggest}>
            {suggesting ? "Drafting" : "Draft"}
          </button>
        </div>
        <p className="hint" style={{ margin: 0 }}>Fills in the fields below — still needs Save.</p>
        {suggestError && <ErrorNote error={suggestError} />}
      </div>

      <Field label="Meta title" hint={`${titleLen}/60 characters. The blue link text in a search result.`}>
        <input
          className="input"
          value={form.seo.metaTitle || ""}
          onChange={(e) => setSeo({ metaTitle: e.target.value })}
          maxLength={70}
        />
      </Field>

      <Field label="Meta description" hint={`${descLen}/160 characters. The line under the title in a search result.`}>
        <textarea
          className="input"
          rows={3}
          value={form.seo.metaDescription || ""}
          onChange={(e) => setSeo({ metaDescription: e.target.value })}
          maxLength={200}
        />
      </Field>

      <Field label="Keywords" hint="Comma-separated. What a prospective student would actually search for.">
        <input
          className="input"
          value={(form.seo.keywords || []).join(", ")}
          onChange={(e) => setSeo({ keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
        />
      </Field>

      <Field label="Social share image" hint="Shown when the link is shared on Facebook/WhatsApp/Twitter/etc. Falls back to your logo if left blank.">
        <input
          className="input"
          value={form.seo.ogImage || ""}
          onChange={(e) => setSeo({ ogImage: e.target.value })}
          placeholder="https://..."
        />
      </Field>

      <Field label="Canonical URL" hint="Only needed if this install is reachable at more than one address.">
        <input
          className="input"
          value={form.seo.canonicalUrl || ""}
          onChange={(e) => setSeo({ canonicalUrl: e.target.value })}
          placeholder="https://yourdomain.com"
        />
      </Field>

      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={Boolean(form.seo.noIndex)}
          onChange={(e) => setSeo({ noIndex: e.target.checked })}
        />
        <EyeOff size={13} className="muted" />
        <span className="small">Hide from search engines (noindex)</span>
      </label>

      <div className="card-quiet stack" style={{ gap: 10 }}>
        <span className="label">Course pages</span>
        <label className="row-tight" style={{ cursor: "pointer", gap: 8 }}>
          <input type="checkbox" checked={Boolean(form.seo.coursePages)} onChange={(e) => setSeo({ coursePages: e.target.checked })} />
          <span className="small">Give every course its own public page (yoursite.com/courses/course-name)</span>
        </label>
        <p className="hint" style={{ margin: 0 }}>
          {form.seo.coursePages
            ? "Course cards on the landing page open the course's page. Each page has its own title, description and preview picture for search and sharing, and is listed in the sitemap. Change a course's address in its settings (Public page address)."
            : "Off: course cards open the pop-up, as now."}
        </p>
        {form.seo.coursePages && (
          <>
            <CourseDesignPicker value={form.seo.courseDesign} onChange={(courseDesign) => setSeo({ courseDesign })} />
            <CourseThemePicker value={form.seo.courseTheme} custom={form.seo.courseCustomTheme} appUi={settings.studentUi} onChange={setSeo} />
            <CourseSeoList />
          </>
        )}
      </div>

      <ErrorNote error={saveError} />

      <button className="btn" style={{ alignSelf: "flex-start" }} disabled={saving} onClick={() => update(form)}>
        {saving ? "Saving" : "Save"}
      </button>
    </div>
  );
}

// The provider form and the model manager share the saved model name, so they
// live under one component: picking a downloaded model has to write straight
// into the field above it.
const AI_TABS = [
  ["connection", "Connection", Plug],
  ["features", "Features", ToggleRight],
  ["courseChat", "Course chat", MessagesSquare],
  ["pora", "Oral Quiz", Mic],
  ["tutoring", "AI Tutoring", PenLine],
  ["interview", "Interview practice", UsersIcon],
  ["limits", "Limits & credits", Wallet],
  ["agents", "Agents", AgentsGlyph],
  ["voice", "Video lessons", AudioLines],
];

function AiSection() {
  const { data: config } = useGetAiConfigQuery();
  const [update] = useUpdateAiConfigMutation();
  const [sub, setSub] = useState(() => {
    const v = new URLSearchParams(window.location.search).get("sub");
    return AI_TABS.some(([k]) => k === v) ? v : "connection";
  });
  const pick = (v) => {
    setSub(v);
    // Linkable (the Agents page sends people to ?tab=ai&sub=agents).
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "ai");
    url.searchParams.set("sub", v);
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <div className="subtabs" role="tablist">
        {AI_TABS.map(([value, label, Icon]) => (
          <button key={value} role="tab" aria-selected={sub === value} className={`subtab${sub === value ? " subtab-on" : ""}`} onClick={() => pick(value)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {/* Mounted on every sub-tab so unsaved edits survive switching. */}
      <AiSettings section={sub} />
      {sub === "agents" && <AgentSettings />}
      {sub === "features" && <ImageSettings />}
      {sub === "voice" && <><VoiceSettings /><VideoBoardSettings /></>}
      {sub === "connection" && config?.provider === "custom" && (
        <LocalModels
          currentModel={config.model}
          onUse={(name) => update({ model: name })}
        />
      )}
      {sub === "connection" && config?.provider === "embedded" && (
        <EmbeddedModels
          currentModel={config.model}
          onUse={(id) => update({ model: id })}
        />
      )}
      {sub === "limits" && <GeneralCreditPlans />}
    </>
  );
}

// Not tied to any one batch — covers AI use on whichever batch a student
// happens to be using when that batch's own daily allowance runs out.
// Same CRUD shape as a batch's own credit packs (see BatchDetail), just
// scoped platform-wide instead of to one batch's students.
function GeneralCreditPlans() {
  const { data: plans, isLoading } = useGetGeneralCreditPlansQuery();
  const [addPlan] = useAddGeneralCreditPlanMutation();
  const [updatePlan] = useUpdateGeneralCreditPlanMutation();
  const [deletePlan] = useDeleteGeneralCreditPlanMutation();
  const [draft, setDraft] = useState(null);
  const confirm = useConfirm();

  return (
    <div className="card stack">
      <div className="spread">
        <div className="row-tight"><Wallet size={17} className="muted" /><h2>General AI credit packs</h2></div>
        <button className="btn btn-sm btn-quiet" onClick={() => setDraft({ label: "", credits: "", price: "" })}>
          <Plus size={13} /> Add pack
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Not tied to any one batch — a student can spend these on any batch's
        AI use once that batch's own daily allowance (or its own credits, if
        it has any) runs out. Batches can still sell their own credit packs
        too, from that batch's own settings; both kinds work the same way
        underneath, just checked in a different order.
      </p>

      {draft && (
        <form
          className="card-quiet stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await addPlan({ label: draft.label, credits: Number(draft.credits), price: Number(draft.price) }).unwrap();
            setDraft(null);
          }}
        >
          <div className="row">
            <Field label="Name"><input className="input" autoFocus placeholder="50 AI calls" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field label="Credits"><input className="input tnum" type="number" min="1" value={draft.credits} onChange={(e) => setDraft({ ...draft, credits: e.target.value })} /></Field>
            <Field label="Price"><input className="input tnum" type="number" min="0" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
          </div>
          <div className="row">
            <button className="btn btn-sm" disabled={!draft.label || !draft.credits || draft.price === ""}>Add pack</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <Loading />
      ) : (plans || []).length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No general credit packs yet.</p>
      ) : (
        plans.map((plan) => (
          <div className="card-quiet spread" key={plan._id} style={{ padding: 11 }}>
            <div className="grow">
              <strong style={{ fontWeight: 500 }}>{plan.label}</strong>
              <div className="muted small tnum">{plan.credits} AI calls</div>
            </div>
            <span className="tnum" style={{ fontSize: 15 }}>{plan.price}</span>
            <label className="row-tight small" style={{ marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={plan.isActive}
                onChange={() => updatePlan({ planId: plan._id, isActive: !plan.isActive })}
              />
              Visible
            </label>
            <button
              className="icon-btn icon-btn-danger"
              title="Remove this pack"
              onClick={async () => {
                const yes = await confirm({
                  title: `Remove "${plan.label}"?`,
                  body: "Students who already bought it keep the credits they were granted.",
                  confirmLabel: "Remove",
                });
                if (yes) deletePlan(plan._id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// Recent course-chat questions the lecture documents couldn't answer — a
// to-do list of what the notes are missing.
function DocChatQuestions() {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useGetDocChatQuestionsQuery({}, { skip: !open });
  const rows = data?.questions || [];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} questions the documents couldn't answer
      </button>
      {open && (isFetching ? (
        <Loading />
      ) : rows.length === 0 ? (
        <span className="hint">None yet — every question so far was answered from the course documents.</span>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {rows.slice(0, 50).map((r, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
              <div className="small"><strong>{r.question}</strong></div>
              <div className="hint">
                {[r.batch?.name, r.lecture?.title || "Whole course", r.student?.name, new Date(r.at).toLocaleString()].filter(Boolean).join(" · ")}
                {r.generalAnswer ? " · answered from general knowledge" : " · not answered"}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AiSettings({ section = "connection" }) {
  const { data: config, isLoading } = useGetAiConfigQuery();
  const [update, { isLoading: saving, error: saveError }] = useUpdateAiConfigMutation();
  const [test, { isLoading: testing, data: testResult, error: testError }] =
    useTestAiConnectionMutation();

  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (config && !form) {
      const initial = {
        provider: config.provider,
        baseUrl: config.baseUrl || "",
        model: config.model || "",
        visionModel: config.visionModel || "",
        features: { ...config.features },
        limits: { ...config.limits },
        pricing: { ...config.pricing },
        featureCosts: { ...config.featureCosts },
        docChat: { allowGeneral: true, scope: "both", dailyMessages: 30, embeddingModel: "", packSize: 10, packCost: 2, packCarryOver: false, ...(config.docChat || {}) },
        handwritingCheck: { exam: "hold", practice: "flag", ...(config.handwritingCheck || {}) },
        practiceQna: { maxPerQuestion: 5, ...(config.practiceQna || {}) },
        hints: { matchLanguage: true, ...(config.hints || {}) },
        languages: { solutions: true, explanations: true, qna: true, ...(config.languages || {}) },
        studentVideos: { dailyPerStudent: 3, maxParts: 3, ...(config.studentVideos || {}) },
        poraDhora: { dailyQuestions: 10, packSize: 10, packCost: 2, packCarryOver: false, questionsPerSession: 5, followUps: 1, layout: "call", layoutSwitch: true, speak: true, teacherName: "", ...(config.poraDhora || {}) },
        aiTutor: { dailyQuestions: 10, packSize: 10, packCost: 2, packCarryOver: false, questionsPerSession: 5, followUps: 1, layout: "chat", tutorName: "", partMarks: [1, 2, 3, 4], strictness: "normal", hintPenalty: 0, stepMarking: false, criteriaWeight: 0, ...(config.aiTutor || {}) },
        interview: { dailyQuestions: 10, packSize: 10, packCost: 2, packCarryOver: false, followUps: 1, layout: "panel", answerSeconds: 90, typing: false, speak: true, lectureViva: true, ownInterview: true, strictness: "normal", ...(config.interview || {}) },
      };
      setForm(initial);
      setSaved(JSON.stringify(initial));
    }
  }, [config, form]);

  if (section === "agents" || section === "voice") return null;
  if (isLoading || !form) return <div className="card"><Loading /></div>;
  const dirty = Boolean(apiKey) || JSON.stringify(form) !== saved;

  const set = (patch) => setForm({ ...form, ...patch });

  const save = async () => {
    // An untouched key field must not clear the stored key, so it is only sent
    // when the field has been typed into.
    const r = await update({ ...form, ...(apiKey ? { apiKey } : {}) });
    if (!r.error) { setApiKey(""); setSaved(JSON.stringify(form)); }
  };
  const HEAD = {
    connection: [Sparkles, "Connection", "Connect your own provider, or point this at a model running on your own hardware. Nothing here is required — the platform works with AI switched off."],
    features: [ToggleRight, "Features", "What AI is allowed to do. A batch also has to allow each one in its own settings."],
    courseChat: [MessagesSquare, "Course chat", "Students asking questions about their lectures and course documents."],
    pora: [Mic, "Oral Quiz", "An AI teacher checks whether a student has read a lecture: asks, follows up, marks each answer, and writes a report. Billed per question answered, like course chat."],
    tutoring: [PenLine, "AI Tutoring", "A written lesson check on a lecture: the tutor asks, marks each answer and writes a report. Billed per question answered, like Oral Quiz."],
    interview: [UsersIcon, "Interview practice", "A panel of AI interviewers asks out loud and the student answers out loud: board vivas, admission, scholarship and job interviews. Feedback with scores, tips and a better answer. Billed per question answered, like Oral Quiz."],
    limits: [Wallet, "Limits & credits", "Free daily calls, the spend cap, and what each AI call costs in credits."],
  };
  const [HeadIcon, title, intro] = HEAD[section] || HEAD.connection;

  return (
    <div className="card stack">
      <div className="spread">
        <div className="row-tight"><HeadIcon size={17} className="muted" /><h2>{title}</h2></div>
        {section === "connection" && config.hasApiKey && (
          <span className="pill row-tight" style={{ gap: 5 }}>
            <Lock size={11} /> Key ending {config.apiKeyLast4}
          </span>
        )}
      </div>

      <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>{intro}</p>

      <ErrorNote error={saveError} />

      {config.warnings?.map((warning) => (
        <div className="banner banner-warn row-tight" key={warning}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{warning}</span>
        </div>
      ))}

      {section === "connection" && (<>
      <Field label="Provider">
        <select
          className="select"
          value={form.provider}
          onChange={(e) => set({ provider: e.target.value })}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </Field>

      {form.provider === "custom" && (
        <Field
          label="Address"
          hint="Ollama runs at http://localhost:11434/v1. LM Studio and vLLM work the same way."
        >
          <input autoComplete="off"
            className="input"
            placeholder="http://localhost:11434/v1"
            value={form.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </Field>
      )}

      {form.provider === "embedded" ? (
        <p className="hint" style={{ margin: 0 }}>
          Pick a model to download and use in "Built-in models" below. A
          model marked "vision" can read doubt photos and image-based
          answers; a text-only one will fail with a clear error on those
          rather than silently ignoring the image, so pick a vision model if
          you want those features working.
        </p>
      ) : (
        <>
          <Field
            label="Model"
            hint={form.provider === "custom" ? "For example qwen2.5:14b" : "For example gpt-4o-mini"}
          >
            <input autoComplete="off"
              className="input"
              value={form.model}
              onChange={(e) => set({ model: e.target.value })}
            />
          </Field>

          <Field
            label="Vision model"
            hint="Used whenever a call attaches an image — doubt photos, and grading a written answer submitted as an image. Leave blank to use the model above for these too, but only if it can actually see images: a text-only model given an image still returns a plausible-looking answer, just one that ignored the picture and graded off the rubric and model answer alone."
          >
            <input autoComplete="off"
              className="input"
              placeholder={form.provider === "custom" ? "For example qwen2.5vl:7b" : "For example gpt-4o"}
              value={form.visionModel}
              onChange={(e) => set({ visionModel: e.target.value })}
            />
          </Field>

          <Field
            label="API key"
            hint={
              form.provider === "custom"
                ? "Most local servers do not need one."
                : config.hasApiKey
                  ? "Leave blank to keep the key you already saved."
                  : "Stored encrypted. It is never shown again."
            }
          >
            <PasswordInput
              autoComplete="new-password"
              placeholder={config.hasApiKey ? "••••••••" : ""}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        </>
      )}
      </>)}

      {section === "features" && (
      <div className="field">
        <div className="stack" style={{ gap: 0 }}>
          {FEATURES.map(([key, label, hint]) => (
            <label
              key={key}
              className="spread"
              style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}
            >
              <span className="grow">
                <span style={{ display: "block" }}>{label}</span>
                <span className="hint">{hint}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(form.features[key])}
                onChange={(e) =>
                  set({ features: { ...form.features, [key]: e.target.checked } })
                }
              />
            </label>
          ))}
        </div>
      </div>
      )}

      {section === "features" && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <Field label="Hint language" hint="Hints in practice and the archive.">
            <select className="select" value={form.hints.matchLanguage ? "match" : "free"}
              onChange={(e) => set({ hints: { ...form.hints, matchLanguage: e.target.value === "match" } })}>
              <option value="match">Same as the question</option>
              <option value="free">Let the AI choose</option>
            </select>
          </Field>
          {[
            ["solutions", "AI solution language", "Solutions AI writes for questions that have none."],
            ["explanations", "\"Explain why\" language", "Why a student's answer was wrong, in practice and the archive."],
            ["qna", "Questions on solutions: language", "Answers to a student's question about a practice solution."],
          ].map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <select className="select" value={form.languages[key] ? "match" : "free"}
                onChange={(e) => set({ languages: { ...form.languages, [key]: e.target.value === "match" } })}>
                <option value="match">Same as the question</option>
                <option value="free">{key === "qna" ? "Same as the student's message" : "Let the AI choose"}</option>
              </select>
            </Field>
          ))}
          {form.features.practiceQna && (
            <Field label="Questions per practice question" hint="How many follow-ups a student may ask on one question.">
              <input className="input" type="number" min={1} max={20} style={{ maxWidth: 120 }}
                value={form.practiceQna.maxPerQuestion}
                onChange={(e) => set({ practiceQna: { ...form.practiceQna, maxPerQuestion: Number(e.target.value) } })} />
            </Field>
          )}
          {form.features.studentVideos && (
            <>
              <Field label="Short videos per student a day">
                <input className="input" type="number" min={1} max={50} style={{ maxWidth: 120 }}
                  value={form.studentVideos.dailyPerStudent}
                  onChange={(e) => set({ studentVideos: { ...form.studentVideos, dailyPerStudent: Number(e.target.value) } })} />
              </Field>
              <Field label="Length" hint="Parts in a short video, each a few sentences.">
                <select className="select" value={form.studentVideos.maxParts}
                  onChange={(e) => set({ studentVideos: { ...form.studentVideos, maxParts: Number(e.target.value) } })}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>Up to {n} part{n === 1 ? "" : "s"}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      )}

      {/* When AI grading reads an answer photo that isn't the student's own
          handwriting: a book page, printed text, a screenshot. */}
      {section === "features" && (
        <div className="field stack" style={{ gap: 8 }}>
          <span className="label">Handwriting check on answer photos</span>
          <span className="hint">When AI grading finds a written answer's photo is a book page, printed text or a screenshot rather than the student's own handwriting.</span>
          <div className="spread" style={{ gap: 12 }}>
            <span className="grow">Exams</span>
            <select className="select" style={{ maxWidth: 280 }} value={form.handwritingCheck.exam} onChange={(e) => set({ handwritingCheck: { ...form.handwritingCheck, exam: e.target.value } })}>
              <option value="off">Off</option>
              <option value="flag">Flag it, keep the AI mark</option>
              <option value="hold">Flag it, a teacher must apply the mark</option>
              <option value="zero">Flag it, AI mark 0</option>
            </select>
          </div>
          <div className="spread" style={{ gap: 12 }}>
            <span className="grow">Practice</span>
            <select className="select" style={{ maxWidth: 280 }} value={form.handwritingCheck.practice} onChange={(e) => set({ handwritingCheck: { ...form.handwritingCheck, practice: e.target.value } })}>
              <option value="off">Off</option>
              <option value="flag">Tell the student, keep the mark</option>
              <option value="zero">Tell the student, 0 marks</option>
            </select>
          </div>
        </div>
      )}

      {section === "pora" && !form.features.poraDhora && (
        <div className="card-quiet small">Oral Quiz is off. Turn it on under <strong>Features</strong>.</div>
      )}
      {section === "pora" && form.features.poraDhora && (() => {
        const p = form.poraDhora;
        const setP = (patch) => set({ poraDhora: { ...p, ...patch } });
        return (
          <div className="field">
            <div className="stack" style={{ gap: 10, marginTop: 4 }}>
              <Field label="Free questions per student per day" hint="A question counts when the student first answers it; follow-ups, hints and skips are free. These don't use the student's AI allowance or credits. 0 = no daily limit: every teacher turn is then charged like any AI call (the Oral Quiz cost under Limits & credits).">
                <input className="input" type="number" min="0" value={p.dailyQuestions} onChange={(e) => setP({ dailyQuestions: Number(e.target.value) })} />
              </Field>
              <Field label="Extra questions for credits" hint="When today's free questions are used up, a student can unlock this many more for this many AI credits (batch credits first, then general). 0 questions = not on sale.">
                <div className="row-tight">
                  <input className="input" type="number" min="0" style={{ maxWidth: 110 }} value={p.packSize} onChange={(e) => setP({ packSize: Number(e.target.value) })} />
                  <span className="small muted">questions for</span>
                  <input className="input" type="number" min="1" style={{ maxWidth: 110 }} value={p.packCost} onChange={(e) => setP({ packCost: Number(e.target.value) })} />
                  <span className="small muted">credits</span>
                </div>
              </Field>
              <label className="spread" style={{ cursor: "pointer" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>Unlocked questions carry over to the next day</span>
                  <span className="hint">Off: they expire at midnight with the free ones.</span>
                </span>
                <input type="checkbox" checked={Boolean(p.packCarryOver)} onChange={(e) => setP({ packCarryOver: e.target.checked })} />
              </label>
              <div className="row">
                <Field label="Questions per session" hint="1 to 15.">
                  <input className="input" type="number" min="1" max="15" value={p.questionsPerSession} onChange={(e) => setP({ questionsPerSession: Number(e.target.value) })} />
                </Field>
                <Field label="Follow-ups per question" hint="0 to 3. The teacher digs deeper when an answer is thin.">
                  <input className="input" type="number" min="0" max="3" value={p.followUps} onChange={(e) => setP({ followUps: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label="Layout students see" hint="Phone call: a live transcript. Teacher: one big question, voice first. Textbook page: after each answer, the line of the lecture it was about.">
                <select className="select" value={p.layout} onChange={(e) => setP({ layout: e.target.value })}>
                  <option value="call">Phone call</option>
                  <option value="teacher">Teacher</option>
                  <option value="page">Textbook page</option>
                </select>
              </Field>
              <label className="spread" style={{ cursor: "pointer" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>The teacher speaks</span>
                  <span className="hint">Uses the voice set up under Video lessons (Bangla voice for Bangla lines). Off, or with no voice set up: the question is shown only. Students answer out loud.</span>
                </span>
                <input type="checkbox" checked={p.speak !== false} onChange={(e) => setP({ speak: e.target.checked })} />
              </label>
              <Field label="Teacher's name (optional)" hint="Shown on screen and used by the teacher, e.g. Rina Ma'am.">
                <input className="input" maxLength={40} value={p.teacherName || ""} onChange={(e) => setP({ teacherName: e.target.value })} />
              </Field>
            </div>
          </div>
        );
      })()}

      {section === "tutoring" && !form.features.aiTutor && (
        <div className="card-quiet small">AI Tutoring is off. Turn it on under <strong>Features</strong>.</div>
      )}
      {section === "tutoring" && form.features.aiTutor && (() => {
        const p = form.aiTutor;
        const setP = (patch) => set({ aiTutor: { ...p, ...patch } });
        return (
          <div className="field">
            <div className="stack" style={{ gap: 10, marginTop: 4 }}>
              <Field label="Layout students get" hint="Fixed for each session when it starts. Tutor chat and Exercise book: questions with follow-ups and hints, each answer marked (the exercise book strikes out the wrong part in red ink). Creative question: one board-style question, a stimulus and four parts (marks set under Scoring), each marked like an examiner.">
                <select className="select" value={p.layout} onChange={(e) => setP({ layout: e.target.value })}>
                  <option value="chat">Tutor chat</option>
                  <option value="book">Exercise book</option>
                  <option value="paper">Creative question paper</option>
                </select>
              </Field>
              <Field label="Free questions per student per day" hint="A question (or a part of a creative question) counts when the student first answers it; follow-ups, hints and skips are free. These don't use the student's AI allowance or credits. 0 = no daily limit: every tutor turn is then charged like any AI call (the AI Tutoring cost under Limits & credits).">
                <input className="input" type="number" min="0" value={p.dailyQuestions} onChange={(e) => setP({ dailyQuestions: Number(e.target.value) })} />
              </Field>
              <Field label="Extra questions for credits" hint="When today's free questions are used up, a student can unlock this many more for this many AI credits (batch credits first, then general). 0 questions = not on sale.">
                <div className="row-tight">
                  <input className="input" type="number" min="0" style={{ maxWidth: 110 }} value={p.packSize} onChange={(e) => setP({ packSize: Number(e.target.value) })} />
                  <span className="small muted">questions for</span>
                  <input className="input" type="number" min="1" style={{ maxWidth: 110 }} value={p.packCost} onChange={(e) => setP({ packCost: Number(e.target.value) })} />
                  <span className="small muted">credits</span>
                </div>
              </Field>
              <label className="spread" style={{ cursor: "pointer" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>Unlocked questions carry over to the next day</span>
                  <span className="hint">Off: they expire at midnight with the free ones.</span>
                </span>
                <input type="checkbox" checked={Boolean(p.packCarryOver)} onChange={(e) => setP({ packCarryOver: e.target.checked })} />
              </label>
              {p.layout !== "paper" && (
                <div className="row">
                  <Field label="Questions per session" hint="1 to 15.">
                    <input className="input" type="number" min="1" max="15" value={p.questionsPerSession} onChange={(e) => setP({ questionsPerSession: Number(e.target.value) })} />
                  </Field>
                  <Field label="Follow-ups per question" hint="0 to 3. The tutor digs deeper when an answer is thin.">
                    <input className="input" type="number" min="0" max="3" value={p.followUps} onChange={(e) => setP({ followUps: Number(e.target.value) })} />
                  </Field>
                </div>
              )}
              <Field label="Tutor's name (optional)" hint="Shown on screen and used by the tutor.">
                <input className="input" maxLength={40} value={p.tutorName || ""} onChange={(e) => setP({ tutorName: e.target.value })} />
              </Field>
              <span className="label" style={{ marginTop: 6 }}>Scoring</span>
              <span className="hint" style={{ marginTop: -6 }}>Fixed for each session when it starts.</span>
              <Field label="Strictness" hint="How hard the AI marks each answer.">
                <select className="select" value={p.strictness} onChange={(e) => setP({ strictness: e.target.value })}>
                  <option value="lenient">Lenient: credit the right idea, even loosely worded</option>
                  <option value="normal">Normal</option>
                  <option value="strict">Strict: full marks only for complete, precise answers</option>
                </select>
              </Field>
              <label className="spread" style={{ cursor: "pointer" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>Board step marking</span>
                  <span className="hint">Creative question: each part's marks split by levels (knowledge, comprehension, application, higher ability), given for each level the answer reaches. Chat and book: working earns marks even when the final answer is wrong.</span>
                </span>
                <input type="checkbox" checked={Boolean(p.stepMarking)} onChange={(e) => setP({ stepMarking: e.target.checked })} />
              </label>
              <Field label="Marks per part (creative question)" hint="ক, খ, গ, ঘ. 1 to 20 each. Board papers use 1, 2, 3, 4.">
                <div className="row-tight">
                  {["ক", "খ", "গ", "ঘ"].map((l, i) => (
                    <label key={l} className="row-tight small muted">
                      {l}
                      <input
                        className="input"
                        type="number"
                        min="1"
                        max="20"
                        style={{ maxWidth: 70 }}
                        value={p.partMarks?.[i] ?? i + 1}
                        onChange={(e) => {
                          const next = [...(p.partMarks || [1, 2, 3, 4])];
                          next[i] = Number(e.target.value);
                          setP({ partMarks: next });
                        }}
                      />
                    </label>
                  ))}
                  <span className="small muted">= {(p.partMarks || [1, 2, 3, 4]).reduce((a, b) => a + (Number(b) || 0), 0)} total</span>
                </div>
              </Field>
              <Field label="Hint penalty (chat and book)" hint="Marks (out of 10) taken off a question for each hint used on it. 0 = hints are free.">
                <input className="input" type="number" min="0" max="5" step="0.5" style={{ maxWidth: 110 }} value={p.hintPenalty} onChange={(e) => setP({ hintPenalty: Number(e.target.value) })} />
              </Field>
              <label className="spread" style={{ cursor: "pointer" }}>
                <span className="grow">
                  <span style={{ display: "block" }}>Report criteria count towards the score</span>
                  <span className="hint">Understanding, accuracy, explaining and use of terms (each out of 5). Off: the score is the marks only.</span>
                </span>
                <input type="checkbox" checked={p.criteriaWeight > 0} onChange={(e) => setP({ criteriaWeight: e.target.checked ? 20 : 0 })} />
              </label>
              {p.criteriaWeight > 0 && (
                <Field label="Criteria share of the score (%)" hint="1 to 50. The rest comes from the marks.">
                  <input className="input" type="number" min="1" max="50" style={{ maxWidth: 110 }} value={p.criteriaWeight} onChange={(e) => setP({ criteriaWeight: Number(e.target.value) })} />
                </Field>
              )}
            </div>
          </div>
        );
      })()}

      {section === "interview" && !form.features.interview && (
        <div className="card-quiet small">Interview practice is off. Turn it on under <strong>Features</strong>.</div>
      )}
      {section === "interview" && form.features.interview && (() => {
        const p = form.interview;
        const setP = (patch) => set({ interview: { ...p, ...patch } });
        const check = (key, label, hint) => (
          <label className="spread" style={{ cursor: "pointer" }}>
            <span className="grow">
              <span style={{ display: "block" }}>{label}</span>
              {hint && <span className="hint">{hint}</span>}
            </span>
            <input type="checkbox" checked={Boolean(p[key])} onChange={(e) => setP({ [key]: e.target.checked })} />
          </label>
        );
        return (
          <>
            <div className="field">
              <div className="stack" style={{ gap: 10, marginTop: 4 }}>
                <Field label="Layout students get" hint="Viva panel: a board of up to three examiners round a table. Examination board: a dark, formal desk with the question large. Video interview: a video call with one interviewer, captions and an optional self-view (camera shown on the student's screen only, never recorded).">
                  <select className="select" value={p.layout} onChange={(e) => setP({ layout: e.target.value })}>
                    <option value="panel">Viva panel</option>
                    <option value="board">Examination board</option>
                    <option value="video">Video interview</option>
                  </select>
                </Field>
                <Field label="Time per answer (seconds)" hint="The clock starts once the question has been asked. When it runs out, what was said so far is sent. 0 = no limit.">
                  <input className="input" type="number" min="0" max="600" style={{ maxWidth: 110 }} value={p.answerSeconds} onChange={(e) => setP({ answerSeconds: Number(e.target.value) })} />
                </Field>
                <Field label="Follow-ups per question" hint="0 to 3. The panel probes what the student actually said.">
                  <input className="input" type="number" min="0" max="3" style={{ maxWidth: 110 }} value={p.followUps} onChange={(e) => setP({ followUps: Number(e.target.value) })} />
                </Field>
                <Field label="Strictness" hint="How hard the panel marks each answer.">
                  <select className="select" value={p.strictness} onChange={(e) => setP({ strictness: e.target.value })}>
                    <option value="lenient">Lenient</option>
                    <option value="normal">Normal</option>
                    <option value="strict">Strict, like a demanding real panel</option>
                  </select>
                </Field>
                {check("speak", "The panel speaks its questions", "Uses the voice set up under Video lessons. Off, or with no voice set up: the questions are shown only.")}
                {check("typing", "Students may type instead of speaking", "Off: answers are spoken only, like a real interview.")}
                {check("lectureViva", "Viva on any lecture", "Students pick a lecture and a viva board asks from its notes and files.")}
                {check("ownInterview", "Students can describe their own interview", "e.g. \"Dhaka University admission, Unit A\" or \"junior accountant at a bank\": a fitting panel is set up for it.")}
                <Field label="Free questions per student per day" hint="A question counts when the student first answers it; follow-ups and passes are free. These don't use the student's AI allowance or credits. 0 = no daily limit: every panel turn is then charged like any AI call (the Interview practice cost under Limits & credits).">
                  <input className="input" type="number" min="0" style={{ maxWidth: 110 }} value={p.dailyQuestions} onChange={(e) => setP({ dailyQuestions: Number(e.target.value) })} />
                </Field>
                <Field label="Extra questions for credits" hint="When today's free questions are used up, a student can unlock this many more for this many AI credits. 0 questions = not on sale.">
                  <div className="row-tight">
                    <input className="input" type="number" min="0" style={{ maxWidth: 110 }} value={p.packSize} onChange={(e) => setP({ packSize: Number(e.target.value) })} />
                    <span className="small muted">questions for</span>
                    <input className="input" type="number" min="1" style={{ maxWidth: 110 }} value={p.packCost} onChange={(e) => setP({ packCost: Number(e.target.value) })} />
                    <span className="small muted">credits</span>
                  </div>
                </Field>
                {check("packCarryOver", "Unlocked questions carry over to the next day", "Off: they expire at midnight with the free ones.")}
              </div>
            </div>
            <InterviewSets />
          </>
        );
      })()}

      {section === "courseChat" && !form.features.docChat && (
        <div className="card-quiet small">Course chat is off. Turn it on under <strong>Features</strong>.</div>
      )}
      {section === "courseChat" && form.features.docChat && (
        <div className="field">
          <span className="label">Course chat</span>
          <div className="stack" style={{ gap: 10, marginTop: 4 }}>
            <label className="spread" style={{ cursor: "pointer" }}>
              <span className="grow">
                <span style={{ display: "block" }}>Answer from general knowledge when the documents don't cover it</span>
                <span className="hint">Always labelled "Not found in your course documents". Off: the student is only told it isn't covered, and pointed to a teacher.</span>
              </span>
              <input
                type="checkbox"
                checked={form.docChat.allowGeneral !== false}
                onChange={(e) => set({ docChat: { ...form.docChat, allowGeneral: e.target.checked } })}
              />
            </label>
            <Field label="Where students can ask">
              <select className="select" value={form.docChat.scope} onChange={(e) => set({ docChat: { ...form.docChat, scope: e.target.value } })}>
                <option value="both">On each lecture and for the whole course</option>
                <option value="lecture">Only on each lecture (\"Ask this lecture\")</option>
                <option value="course">Only for the whole course (\"Ask your course\")</option>
              </select>
            </Field>
            <Field label="Free questions per student per day" hint="These don't use the student's AI allowance or credits. 0 = no daily limit: every answer is then charged like any AI call (the course chat cost above), and there are no extra questions to sell.">
              <input
                className="input"
                type="number"
                min="0"
                value={form.docChat.dailyMessages}
                onChange={(e) => set({ docChat: { ...form.docChat, dailyMessages: Number(e.target.value) } })}
              />
            </Field>
            <Field
              label="Extra questions for credits"
              hint="When a student has used today's free questions, they can unlock this many more for this many AI credits (batch credits first, then general). 0 questions = not on sale. Unlocked questions aren't charged again per answer."
            >
              <div className="row-tight">
                <input
                  className="input"
                  type="number"
                  min="0"
                  style={{ maxWidth: 110 }}
                  value={form.docChat.packSize ?? 10}
                  onChange={(e) => set({ docChat: { ...form.docChat, packSize: Number(e.target.value) } })}
                />
                <span className="small muted">questions for</span>
                <input
                  className="input"
                  type="number"
                  min="1"
                  style={{ maxWidth: 110 }}
                  value={form.docChat.packCost ?? 2}
                  onChange={(e) => set({ docChat: { ...form.docChat, packCost: Number(e.target.value) } })}
                />
                <span className="small muted">credits</span>
              </div>
            </Field>
            <label className="spread" style={{ cursor: "pointer" }}>
              <span className="grow">
                <span style={{ display: "block" }}>Unlocked questions carry over to the next day</span>
                <span className="hint">Off: unlocked questions are for that day only and expire at midnight with the free ones.</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(form.docChat.packCarryOver)}
                onChange={(e) => set({ docChat: { ...form.docChat, packCarryOver: e.target.checked } })}
              />
            </label>
            <Field
              label="Embeddings model (optional)"
              hint="Adds meaning-based search to keyword search, so a question worded differently from the notes still finds them. e.g. text-embedding-3-small (OpenAI), text-embedding-004 (Gemini), nomic-embed-text (Ollama). Empty = keyword search only. Re-index lectures after setting it."
            >
              <input
                className="input"
                value={form.docChat.embeddingModel}
                placeholder="text-embedding-3-small"
                onChange={(e) => set({ docChat: { ...form.docChat, embeddingModel: e.target.value } })}
              />
            </Field>
            <DocChatQuestions />
          </div>
        </div>
      )}

      {section === "connection" && form.provider !== "embedded" && (
        <div className="field">
          <span className="label">Pricing override</span>
          <p className="hint" style={{ margin: "2px 0 10px" }}>
            Needed for the cost numbers below and the spend cap under
            "Spending limits" to mean anything on a custom endpoint — Groq,
            OpenRouter, DeepSeek, Together and a genuinely free local server
            (Ollama, LM Studio) all connect the same OpenAI-compatible way,
            and there's no way to tell a paid one from a free one
            automatically. Known hosted models (GPT-4o, Claude, Gemini) are
            priced automatically and don't need this. Leave both at 0 for a
            free local model — that's also what happens if you leave this
            blank on a paid one, silently, so it's worth setting correctly.
          </p>
          <div className="row">
            <Field label="Input, $ per 1M tokens">
              <input
                className="input tnum"
                type="number"
                min="0"
                step="0.01"
                value={form.pricing?.inputPerMillion ?? 0}
                onChange={(e) => set({ pricing: { ...form.pricing, inputPerMillion: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Output, $ per 1M tokens">
              <input
                className="input tnum"
                type="number"
                min="0"
                step="0.01"
                value={form.pricing?.outputPerMillion ?? 0}
                onChange={(e) => set({ pricing: { ...form.pricing, outputPerMillion: Number(e.target.value) } })}
              />
            </Field>
          </div>
        </div>
      )}

      {section === "limits" && (<>
      <div className="field">
        <span className="label">Spending limits</span>
        <p className="hint" style={{ margin: "2px 0 10px" }}>
          The platform-wide circuit breaker — if a provider misbehaves, a
          bug causes a runaway loop, or usage just spikes harder than
          expected, this is what actually stops the bleeding rather than a
          surprise bill. A batch can grant its own students bonus free
          calls per day on top of this default (in that batch's own
          settings) — added on top, never a replacement, so a batch can
          only ever give its students more than everyone else already
          gets here, never less.
        </p>
        <div className="row">
          <Field label="Default free AI calls, per student per day">
            <input
              className="input tnum"
              type="number"
              min="0"
              value={form.limits.dailyCallsPerStudent}
              onChange={(e) => set({ limits: { ...form.limits, dailyCallsPerStudent: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Max daily spend, whole platform ($)" hint="0 = no cap">
            <input
              className="input tnum"
              type="number"
              min="0"
              step="0.01"
              value={form.limits.dailyCostCapUsd}
              onChange={(e) => set({ limits: { ...form.limits, dailyCostCapUsd: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Max tokens per call">
            <input
              className="input tnum"
              type="number"
              min="1"
              value={form.limits.maxTokensPerCall}
              onChange={(e) => set({ limits: { ...form.limits, maxTokensPerCall: Number(e.target.value) } })}
            />
          </Field>
        </div>
      </div>

      <div className="field">
        <span className="label">Refund AI credits when a request fails</span>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {[
            [true, "On"],
            [false, "Off"],
          ].map(([value, label]) => (
            <button
              key={label}
              className={`pill pill-btn${(form.limits.refundOnFailure !== false) === value ? " pill-on" : ""}`}
              onClick={() => set({ limits: { ...form.limits, refundOnFailure: value } })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          If the AI answered but the student still got an error (unusable
          reply, a later step failed), give back the credit and the daily
          allowance it used. Failed AI calls are never charged either way.
          Your provider cost stays on the usage page.
        </p>
      </div>

      <div className="field">
        <span className="label">AI credit cost per feature</span>
        <p className="hint" style={{ margin: "2px 0 10px" }}>
          How many purchased AI credits one call costs — only charged once a
          student's free daily AI calls on that batch are used up for the
          day. Doesn't change the free daily count itself, which is always
          one call is one call regardless of feature.
        </p>
        <div className="stack" style={{ gap: 0 }}>
          {FEATURE_COSTS.map(([key, label, hint]) => (
            <div
              key={key}
              className="spread"
              style={{ padding: "10px 0", borderTop: "1px solid var(--border)", alignItems: "center" }}
            >
              <span className="grow">
                <span style={{ display: "block" }}>{label}</span>
                <span className="hint">{hint}</span>
              </span>
              <input
                className="input tnum"
                type="number"
                min="1"
                style={{ width: 80, flexShrink: 0 }}
                value={form.featureCosts[key]}
                onChange={(e) =>
                  set({ featureCosts: { ...form.featureCosts, [key]: Number(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">Archive AI credit cost per feature</span>
        <p className="hint" style={{ margin: "2px 0 10px" }}>
          Same idea as above, priced separately for the public archive — it's
          a shared pool across every batch, not any one batch's own content.
          Each of these also needs its batch-level toggle on (Batches → a
          batch → Archive AI) before it's reachable at all.
        </p>
        <div className="stack" style={{ gap: 0 }}>
          {ARCHIVE_FEATURE_COSTS.map(([key, label, hint]) => (
            <div
              key={key}
              className="spread"
              style={{ padding: "10px 0", borderTop: "1px solid var(--border)", alignItems: "center" }}
            >
              <span className="grow">
                <span style={{ display: "block" }}>{label}</span>
                <span className="hint">{hint}</span>
              </span>
              <input
                className="input tnum"
                type="number"
                min="1"
                style={{ width: 80, flexShrink: 0 }}
                value={form.featureCosts[key]}
                onChange={(e) =>
                  set({ featureCosts: { ...form.featureCosts, [key]: Number(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      </div>
      </>)}

      <div className="row" style={{ alignItems: "center" }}>
        <button className="btn" onClick={save} disabled={saving}>
          <Check size={15} />
          {saving ? "Saving" : "Save"}
        </button>
        {section === "connection" && (
          <button className="btn btn-quiet" onClick={() => test()} disabled={testing}>
            <Plug size={15} />
            {testing ? "Testing" : "Test connection"}
          </button>
        )}
        {dirty && <span className="small" style={{ color: "var(--warning)" }}>Not saved yet (changes on every AI sub-tab are saved together)</span>}
      </div>

      {/* A transport failure lands in `error` rather than `data`, so both are
          read — otherwise pressing the button appears to do nothing. */}
      {section === "connection" && testResult && <Verdict ok={testResult.ok}>{testResult.message}</Verdict>}
      {section === "connection" && !testResult && testError && (
        <Verdict ok={false}>
          {testError?.data?.message || "The test could not be run. Is the server reachable?"}
        </Verdict>
      )}
    </div>
  );
}


// Several gateways run at once, each restricted to the currencies it should
// take. Which one a given charge uses is decided at checkout from the
// currency, not fixed here — so this screen enables and configures, it does
// not "select the active provider" the way a single-gateway install would.
// Platform-wide only — see the comment on AppSettings.notificationSettings
// in the backend for why there is no per-student version of this. Turning a
// type off here means the Notification document is never created for
// anyone, not merely hidden after the fact.
function NotificationSettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error: saveError }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({ ...settings.notificationSettings });
    }
  }, [settings, form]);

  if (isLoading || !form) return <div className="card"><Loading /></div>;

  return (
    <div className="card stack">
      <div className="row-tight"><Bell size={17} className="muted" /><h2>Notifications</h2></div>
      <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
        Which events actually reach a student's notification bell. Off means
        off entirely — no record of it is ever created for anyone, not just
        hidden from the list.
      </p>

      <ErrorNote error={saveError} />

      <div className="stack" style={{ gap: 0 }}>
        {NOTIFICATION_TYPES.map(([key, label, hint]) => (
          <label
            key={key}
            className="spread"
            style={{ padding: "10px 0", borderTop: "1px solid var(--border)", cursor: "pointer" }}
          >
            <span className="grow">
              <span style={{ display: "block" }}>{label}</span>
              <span className="hint">{hint}</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(form[key])}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
            />
          </label>
        ))}
      </div>

      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        disabled={saving}
        onClick={() => update({ notificationSettings: form })}
      >
        <Check size={15} />
        {saving ? "Saving" : "Save"}
      </button>
    </div>
  );
}

function PaymentGateways() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error: saveError }] = useUpdatePaymentGatewayMutation();
  const [openProvider, setOpenProvider] = useState(null);

  if (isLoading) return <div className="card"><Loading /></div>;

  const gateways = settings?.adapters?.payment || [];
  const live = gateways.filter((g) => g.enabled && g.configured);

  return (
    <div className="card stack">
      <div className="spread">
        <div className="row-tight"><Wallet size={17} className="muted" /><h2>Payment gateways</h2></div>
        <span className="pill">{live.length} live</span>
      </div>

      <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
        Turn on as many as you need. Each one only handles the currencies you
        give it, so you can take BDT locally and USD internationally at the
        same time. Leave the currency list empty to let a gateway take
        anything.
      </p>

      <ErrorNote error={saveError} />

      {gateways.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>No gateway drivers are built into this version yet.</p>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {gateways.map((gateway) => (
          <GatewayRow
            key={gateway.name}
            gateway={gateway}
            open={openProvider === gateway.name}
            onToggleOpen={() => setOpenProvider(openProvider === gateway.name ? null : gateway.name)}
            onSave={(body) => update({ provider: gateway.name, ...body }).unwrap()}
            saving={saving}
          />
        ))}
      </div>
    </div>
  );
}

function GatewayRow({ gateway, open, onToggleOpen, onSave, saving }) {
  const [currencies, setCurrencies] = useState(gateway.currencies.join(", "));
  const [priority, setPriority] = useState(String(gateway.priority));
  // Never seeded from the server — a secret is write-only, so an empty field
  // means "leave whatever is stored alone", exactly like the AI key above.
  const [entered, setEntered] = useState({});

  const ready = gateway.configured;

  const save = async (patch = {}) => {
    const credentials = {};
    for (const [key, value] of Object.entries(entered)) {
      if (value !== "") credentials[key] = value;
    }

    await onSave({
      currencies: currencies.split(",").map((c) => c.trim()).filter(Boolean),
      priority: Number(priority) || 0,
      credentials,
      ...patch,
    });

    setEntered({});
  };

  return (
    <div className="card-quiet stack" style={{ gap: 10 }}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <strong>{gateway.label}</strong>
          <span className="muted small">
            {gateway.enabled && ready
              ? gateway.currencies.length
                ? `Live for ${gateway.currencies.join(", ")}`
                : "Live for every currency"
              : ready
                ? "Configured, not switched on"
                : `Needs ${gateway.missing.join(", ") || "credentials"}`}
          </span>
        </div>

        <div className="row-tight" style={{ gap: 8 }}>
          {gateway.enabled && ready && <span className="pill pill-ok row-tight" style={{ gap: 5 }}><Check size={11} /> On</span>}
          <button type="button" className="btn btn-quiet" onClick={onToggleOpen}>
            {open ? "Close" : "Configure"}
          </button>
        </div>
      </div>

      {open && (
        <div className="stack" style={{ gap: 10 }}>
          {gateway.credentials.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={
                field.envLocked
                  ? `Supplied by ${field.envVar} in the environment. Change it there, not here.`
                  : field.last4
                    ? `Saved, ending ${field.last4}. Leave blank to keep it.`
                    : !field.secret && gateway.config?.[field.key]
                      ? `Saved: ${gateway.config[field.key]}. Leave blank to keep it.`
                      : field.required ? "Required." : "Optional."
              }
            >
              <input
                type={field.secret ? "password" : "text"}
                autoComplete="new-password"
                disabled={field.envLocked}
                placeholder={field.envLocked ? "Set in environment" : field.last4 ? "••••••••" : (!field.secret && gateway.config?.[field.key]) || ""}
                value={entered[field.key] ?? ""}
                onChange={(e) => setEntered({ ...entered, [field.key]: e.target.value })}
              />
            </Field>
          ))}

          <Field label="Currencies" hint="Comma separated, e.g. BDT, USD. Empty means any currency.">
            <input value={currencies} onChange={(e) => setCurrencies(e.target.value)} placeholder="BDT, USD" />
          </Field>

          <Field label="Priority" hint="Lower goes first when more than one gateway takes the same currency.">
            <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </Field>

          <div className="row-tight" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={saving} onClick={() => save()}>
              {saving ? "Saving" : "Save"}
            </button>

            <button
              type="button"
              className="btn btn-quiet"
              disabled={saving}
              onClick={() => save({ enabled: !gateway.enabled })}
            >
              {gateway.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>

          <p className="muted small" style={{ margin: 0, lineHeight: 1.6 }}>
            {gateway.confirmsByRedirect ? (
              <>
                This gateway confirms by redirect, so there is no webhook to
                register. It sends customers back to
                {" "}<code>/api/app/purchases/callback/{gateway.name}</code>
                {" — "}which means <code>SERVER_URL</code> must be set to this
                API&apos;s public address, or payments complete without ever
                granting access.
              </>
            ) : (
              <>
                Webhook URL for this gateway:
                {" "}<code>/api/app/purchases/webhook/{gateway.name}</code>
                {" — "}paste it into the provider dashboard, or payments will
                complete without ever granting access.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// Settings → Student app → Live classroom: how the in-app classroom looks.
// Where class recordings go. A video provider plays them in its own
// protected player; kept on the server, they play as a plain file.
const RECORDING_TARGETS = [
  ["vdocipher", "VdoCipher", "Strongest: encrypted, expiring links, each student's name over the video."],
  ["bunny", "Bunny Stream", "Expiring signed links: a copied link stops working."],
  ["vimeo", "Vimeo", "Weakest: set “embed only on my domain” in your Vimeo account."],
];
function RecordingDestination({ v, set }) {
  const { data } = useGetMediaProvidersQuery();
  const ready = new Set((data?.video || []).filter((p) => p.upload).map((p) => p.name));
  const to = v.recordingsTo || "storage";
  const chosen = RECORDING_TARGETS.find(([name]) => name === to);
  return (
    <>
      <Field label="Class recordings" hint="Where recordings of in-app classes go once they finish.">
        <select className="input" value={to} onChange={(e) => set({ recordingsTo: e.target.value })}>
          <option value="storage">Keep on this server</option>
          {RECORDING_TARGETS.map(([name, label]) => (
            <option key={name} value={name} disabled={!ready.has(name) && to !== name}>{label}{ready.has(name) ? "" : " (add its keys first)"}</option>
          ))}
        </select>
      </Field>
      {to === "storage" ? (
        <p className="hint" style={{ margin: 0 }}>Students watch them in the app's player with their name over it, but a determined student can still save the file.</p>
      ) : (
        <>
          <p className="hint" style={{ margin: 0 }}>{chosen?.[2]}{ready.has(to) ? "" : " Its keys aren't set on the server yet, so nothing can be sent."}</p>
          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={Boolean(v.recordingsAuto)} onChange={(e) => set({ recordingsAuto: e.target.checked })} />
            <span>Send each recording there as soon as it finishes</span>
          </label>
          <label className="row-tight" style={{ cursor: "pointer", alignItems: "flex-start" }}>
            <input type="checkbox" checked={Boolean(v.recordingsKeepCopy)} onChange={(e) => set({ recordingsKeepCopy: e.target.checked })} />
            <span>
              Keep the server's copy too
              <span className="hint" style={{ display: "block", margin: 0 }}>Off: the file on this server is removed once it's sent, which saves disk space and leaves no plain copy.</span>
            </span>
          </label>
          <p className="hint" style={{ margin: 0 }}>Without the automatic option, send recordings one by one from a class's Recordings page.</p>
        </>
      )}
    </>
  );
}

// What a teacher assigned to an in-app class may do. Admins always can.
function LiveTeacherRules({ value: v, set }) {
  return (
    <>
      <h2 style={{ marginTop: 16 }}>Teachers in the classroom</h2>
      <p className="hint" style={{ margin: 0 }}>
        For teachers assigned to an in-app class. They always join as a host: talk, share screen, manage students, board, polls and Q&amp;A.
      </p>
      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={v.teacherCanStart !== false} onChange={(e) => set({ teacherCanStart: e.target.checked })} />
        <span>Teachers can start the class without an admin</span>
      </label>
      {v.teacherCanStart !== false && (
        <Field label="They can open it from (minutes before the start)">
          <input type="number" min={0} max={240} className="input" style={{ maxWidth: 120 }}
            value={v.teacherEarlyMinutes ?? 10}
            onChange={(e) => set({ teacherEarlyMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })} />
        </Field>
      )}
      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={v.teacherCanRecord !== false} onChange={(e) => set({ teacherCanRecord: e.target.checked })} />
        <span>Teachers can start and stop recording</span>
      </label>
      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={v.teacherCanEnd !== false} onChange={(e) => set({ teacherCanEnd: e.target.checked })} />
        <span>Teachers can end the class for everyone</span>
      </label>
    </>
  );
}

function LiveRoomBranding({ value: v, set, platformLogo }) {
  const logo = v.logo || platformLogo;
  return (
    <>
      <p className="hint" style={{ margin: 0 }}>
        For classes and webinars that run inside the app (provider “In-app classroom”).
        Everything here is optional.
      </p>

      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={v.showLogo !== false} onChange={(e) => set({ showLogo: e.target.checked })} />
        <span>Show the logo in the classroom header</span>
      </label>
      <Field label="Classroom logo" hint={v.logo ? undefined : platformLogo ? "Using the platform logo. Upload one to use a different logo here." : "No platform logo yet; upload one here or under Brand & theme."}>
        <ImagePicker value={null} url={v.logo || null} folder="branding" label="Logo" onChange={(id, url) => set({ logo: url || null })} />
      </Field>

      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={Boolean(v.watermark)} onChange={(e) => set({ watermark: e.target.checked })} disabled={!logo} />
        <span>Logo watermark over the video</span>
      </label>
      {v.watermark && (
        <div className="row-tight" style={{ gap: 12, flexWrap: "wrap" }}>
          <Field label="Corner">
            <select className="input" value={v.watermarkPosition || "br"} onChange={(e) => set({ watermarkPosition: e.target.value })}>
              <option value="tl">Top left</option><option value="tr">Top right</option>
              <option value="bl">Bottom left</option><option value="br">Bottom right</option>
            </select>
          </Field>
          <Field label={`Opacity ${Math.round((v.watermarkOpacity ?? 0.35) * 100)}%`}>
            <input type="range" min="0.05" max="1" step="0.05" value={v.watermarkOpacity ?? 0.35} onChange={(e) => set({ watermarkOpacity: Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <label className="row-tight" style={{ cursor: "pointer", alignItems: "flex-start" }}>
        <input type="checkbox" checked={Boolean(v.nameWatermark)} onChange={(e) => set({ nameWatermark: e.target.checked })} />
        <span>
          Each student's name, faint across the video
          <span className="hint" style={{ display: "block", margin: 0 }}>Anyone who screen-records the class records their own name on it.</span>
        </span>
      </label>

      <Field label="Accent colour" hint="Buttons and highlights in the classroom. Leave empty for the default.">
        <div className="row-tight">
          <input type="color" value={v.accentColor || "#2fa58e"} onChange={(e) => set({ accentColor: e.target.value })} />
          {v.accentColor && <button className="btn btn-sm btn-quiet" onClick={() => set({ accentColor: null })}>Reset</button>}
        </div>
      </Field>

      <Field label="While the host is away" hint="Shown to students when no host is in the room.">
        <input className="input" placeholder="The host will be with you shortly." value={v.waitingMessage || ""} onChange={(e) => set({ waitingMessage: e.target.value || null })} />
      </Field>
      <Field label="Waiting screen image" hint="Optional: a poster or banner instead of the logo.">
        <ImagePicker value={null} url={v.waitingImage || null} folder="branding" label="Image" onChange={(id, url) => set({ waitingImage: url || null })} />
      </Field>

      <RecordingDestination v={v} set={set} />

      <Field label="Promo line" hint="A line under the classroom header, with a button — the next batch, an offer.">
        <input className="input" placeholder="Admissions for the next batch are open" value={v.promoText || ""} onChange={(e) => set({ promoText: e.target.value || null })} />
      </Field>
      <div className="row-tight" style={{ gap: 12, flexWrap: "wrap" }}>
        <Field label="Button text">
          <input className="input" placeholder="Enroll now" value={v.promoLabel || ""} onChange={(e) => set({ promoLabel: e.target.value || null })} />
        </Field>
        <Field label="Button link">
          <input className="input" placeholder="https://…" value={v.promoUrl || ""} onChange={(e) => set({ promoUrl: e.target.value || null })} />
        </Field>
      </div>
    </>
  );
}

// Stored video files (live recordings, exported lessons) not protected yet,
// and the conversions in progress, with one button to protect them all.
function ProtectAllVideos() {
  const [poll, setPoll] = useState(false);
  const { data } = useGetProtectedSummaryQuery(undefined, { pollingInterval: poll ? 5000 : 0 });
  const [protectAll, { isLoading }] = useProtectAllMediaMutation();
  const busy = (data?.counts?.queued || 0) + (data?.counts?.converting || 0);
  useEffect(() => { setPoll(busy > 0); }, [busy]);
  if (!data) return null;
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <span className="hint">
          {data.counts?.ready || 0} protected · {busy} in progress · {data.unprotected} stored video file{data.unprotected === 1 ? "" : "s"} not protected
          {data.counts?.failed ? ` · ${data.counts.failed} failed` : ""}
        </span>
        {data.unprotected > 0 && (
          <button className="btn btn-sm" disabled={isLoading} onClick={() => protectAll({})}>
            Protect all {data.unprotected}
          </button>
        )}
      </div>
      {data.jobs?.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {data.jobs.map((j) => (
            <span key={j._id} className="hint">
              {j.title || "Video"}: {j.status === "failed" ? `failed (${j.error || "unknown"})` : j.status === "queued" ? "waiting" : `${j.progress}%`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
