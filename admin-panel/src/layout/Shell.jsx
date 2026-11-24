import { Suspense, useEffect, useRef, useState } from "react";
import IngestJobs from "../components/IngestJobs";
import TopBar, { matchPage } from "./TopBar";
import { DockRail, sectionsOf } from "./Dock";
import Launcher from "./Launcher";
import { NavBrand } from "./Brand";
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from "react-router-dom";
import {
  LayoutDashboard, FileQuestion, ClipboardList, FolderTree, PlayCircle,
  GraduationCap, Users, Send, Sparkles, CheckCircle2, UserCog, Settings, LogOut,
     PenLine, FileSearch, Clock, HelpCircle, Megaphone, DollarSign, Tag, MonitorSmartphone, Video, ShieldAlert, Library, TrendingUp,
  LifeBuoy, Gauge, House, CircleUserRound, ShieldAlert as ShieldAlertIcon, UserX, ClipboardCheck, BookOpenCheck, Award, Zap, Image, Inbox, BarChart3, Wallet, Radio } from "lucide-react";
import { AgentsGlyph } from "../components/AgentIcons";
import { useSelector } from "react-redux";
import { useGetMeQuery, useLogoutMutation } from "../api/authApi";
import { useGetReviewQueueQuery, useGetOpenAuditsQuery } from "../api/aiApi";
import { useGetPendingReferralsQuery, useGetGradingQueueQuery } from "../api/contentApi";
import { useGetTicketCountsQuery, useGetConductCountsQuery, useGetDeletionCountsQuery } from "../api/accountApi";
import { Loading, ConfirmProvider, useCan } from "../components/bits";
import { useGetAgentStatusQuery } from "../api/agentApi";
import { useGetBadgesQuery } from "../api/badgeApi";
import { hasNew } from "../hooks/useSeen";
import { useTerms } from "../terms";
import { useSelfLook } from "../pages/MyProfile";

// Pages are lazy loaded (App.jsx). The boundary sits here, inside the chrome,
// so the nav stays on screen while a page's code downloads.
const PageOutlet = (props) => (
  <Suspense fallback={<Loading />}>
    <Outlet {...props} />
  </Suspense>
);

// Two shells, one component. Sidebar and rail differ only in width and whether
// labels render, so they share every route and every page below them.
// Grouped so the rail stays readable: authoring, delivery, people, then the
// AI work which is where a decision is usually waiting.
// Grouped by what a session is actually for: authoring, then delivery, then
// the AI work where a decision is usually waiting. `admin` hides an item from
// teachers — the backend refuses those routes anyway, so showing them would
// only offer an action that fails.
const NAV = [
  { to: "/", label: "Overview", Icon: LayoutDashboard, end: true },
  { group: "Content" },
  { to: "/questions", label: "Questions", Icon: FileQuestion },
  { to: "/archive", label: "Archive", Icon: Library, roles: ["owner", "admin"] },
  { to: "/exams", label: "Exams", Icon: ClipboardList },
  { to: "/content", label: "Structure", Icon: FolderTree },
  { to: "/lectures", label: "Lectures", Icon: PlayCircle },
  { to: "/live-classes", label: "Live Classes", Icon: Video, badge: "recordings" },
  { to: "/webinars", label: "Webinars", Icon: Radio, roles: ["owner", "admin"] },
  { to: "/notices", label: "Notices", Icon: Megaphone },
  { to: "/grading", label: "Grading", Icon: PenLine, badge: "grading" },
  { to: "/grading/assignments", label: "Assignments", Icon: ClipboardCheck, badge: "assignments" },
  { to: "/grading/gradebook", label: "Gradebook", Icon: BookOpenCheck },
  { to: "/grading/offline-marks", label: "Offline marks", Icon: ClipboardList },
  { to: "/grading/certificates", label: "Certificates", Icon: Award },
  // Labelled "Regrade requests" rather than "Referrals" — this app already
  // has a real "referral" feature (representative coupon links), and
  // reusing the word for an unrelated queue was confusing the two. Route
  // and API names are untouched, this is display text only.
  { to: "/referrals", label: "Regrade requests", Icon: Clock, roles: ["owner", "admin"], badge: "referrals" },
  { to: "/submissions", label: "Submissions", Icon: FileSearch },
  { to: "/doubts", label: "Doubts", Icon: HelpCircle, roles: ["owner", "admin", "doubtSolver"], badge: "doubts" },
  { to: "/support", label: "Support", Icon: LifeBuoy, roles: ["owner", "admin"], badge: "support" },
  { to: "/conduct", label: "Conduct", Icon: ShieldAlertIcon, roles: ["owner", "admin"], badge: "conduct" },
  { to: "/account-deletions", label: "Account deletions", Icon: UserX, roles: ["owner", "admin"], badge: "deletions" },
  { group: "Marketing" },
  { to: "/earnings", label: "Earnings", Icon: DollarSign, roles: ["owner", "admin"] },
  { to: "/payslips", label: "Payslips", Icon: Wallet, roles: ["owner", "admin"] },
  { to: "/coupons", label: "Coupons", Icon: Tag, roles: ["owner", "admin"] },
  { to: "/campaigns", label: "Campaigns", Icon: Send, roles: ["owner", "admin"] },
  { to: "/automations", label: "Automations", Icon: Zap, roles: ["owner", "admin"] },
  { to: "/leads", label: "Leads", Icon: Inbox, roles: ["owner", "admin"], badge: "leads" },
  { to: "/visitors", label: "Visitors", Icon: BarChart3, roles: ["owner", "admin"] },
  { to: "/posters", label: "Posters", Icon: Image, roles: ["owner", "admin"] },
  { to: "/landing-page", label: "Landing Page", Icon: MonitorSmartphone, roles: ["owner", "admin"] },
  { to: "/updates", label: "Updates", Icon: Sparkles, roles: ["owner", "admin"] },
  { group: "People" },
  { to: "/batches", label: "Batches", Icon: GraduationCap },
  { to: "/students", label: "Students", Icon: Users },
  { to: "/grading/progress-reports", label: "Progress reports", Icon: Send },
  { group: "AI" },
  { to: "/generate", label: "Generate", Icon: Sparkles },
  { to: "/review", label: "Review", Icon: CheckCircle2, badge: "review" },
  { to: "/audits", label: "Audits", Icon: ShieldAlert, badge: "audits" },
  { to: "/predicted-paper", label: "Predicted paper", Icon: TrendingUp },
  { to: "/agents", label: "Agents", Icon: AgentsGlyph, roles: ["owner", "admin"], badge: "agents" },
  { group: null },
  { to: "/team", label: "Team", Icon: UserCog, admin: true },
  { to: "/performance", label: "Performance", Icon: Gauge, roles: ["owner", "admin"] },
  { to: "/settings", label: "Settings", Icon: Settings },
  { to: "/me", label: "My profile", Icon: CircleUserRound },
];

// Assignments live under /grading but have their own nav entry, so Grading
// stays unlit there.
const navClass = (isActive, to, location) => {
  const on = isActive && !(to === "/grading" && (location.pathname.startsWith("/grading/assignments") || location.pathname.startsWith("/grading/gradebook") || location.pathname.startsWith("/grading/offline-marks") || location.pathname.startsWith("/grading/certificates") || location.pathname.startsWith("/grading/progress-reports")));
  return `nav-item${on ? " nav-item-on" : ""}`;
};

// Every team member's own payslips (pages/MyPayslips.jsx).
const MyPayslipsLink = () => (
  <NavLink to="/my-payslips" className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="My payslips">
    <span className="nav-icon"><Wallet size={17} strokeWidth={1.9} /></span>
    <span className="nav-label grow">My payslips</span>
  </NavLink>
);

// Home and My profile, in every role's own small shell.
const HomeLink = () => (
  <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="Home">
    <span className="nav-icon"><House size={17} strokeWidth={1.9} /></span>
    <span className="nav-label grow">Home</span>
  </NavLink>
);
const ProfileLink = () => (
  <NavLink to="/me" className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="My profile">
    <span className="nav-icon"><CircleUserRound size={17} strokeWidth={1.9} /></span>
    <span className="nav-label grow">My profile</span>
  </NavLink>
);
const OWN = [{ to: "/", label: "Home", Icon: House }];
const PROFILE = { to: "/me", label: "My profile", Icon: CircleUserRound };
const ownPage = (p) => p === "/" || p === "/me";

// Inside the person's quiet hours ("22:00"–"08:00" wraps midnight).
const quietNow = (prefs) => {
  const { quietFrom: a, quietTo: b } = prefs || {};
  if (!a || !b) return false;
  const d = new Date();
  const now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return a <= b ? now >= a && now < b : now >= a || now < b;
};

// New work: a chime and a browser notification (asked for once), as the
// person's own alert settings say (My profile → Settings).
function useNewWorkAlert(count, on, { title, body, link, prefs }) {
  const last = useRef(null);
  useEffect(() => {
    if (!on || typeof count !== "number") return;
    if (prefs?.alerts === false || quietNow(prefs)) { last.current = count; return; }
    try { if (window.Notification?.permission === "default") window.Notification.requestPermission(); } catch { /* not supported */ }
    if (last.current !== null && count > last.current) {
      const more = count - last.current;
      if (prefs?.sound !== false) try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1320].forEach((f, k) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.15, ctx.currentTime + k * 0.18); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + k * 0.18 + 0.3); o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + k * 0.18); o.stop(ctx.currentTime + k * 0.18 + 0.32); });
      } catch { /* no sound */ }
      try {
        if (window.Notification?.permission === "granted") {
          const n = new window.Notification(title(more), { body: body(count), tag: link });
          n.onclick = () => { window.focus(); window.location.assign(`${import.meta.env.BASE_URL || "/"}${link}`.replace(/\/\/+/g, "/")); };
        }
      } catch { /* not supported */ }
    }
    last.current = count;
  }, [count, on]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Shell() {
  const terms = useTerms();
  const { layout: picked } = useSelector((s) => s.ui);
  // "modern": a light floating sidebar and a top bar (TopBar.jsx); "glass"
  // the same, frosted over a soft gradient. "dock": section icons and that
  // section's pages (Dock.jsx); "launcher": no sidebar, a grid of every
  // page on the overview (Launcher.jsx). Both are for the full staff nav;
  // the small role shells below show them as "modern". "sidebar" and
  // "rail" are the dark sidebar and its icons-only rail.
  // The dock's section picked by hand, on the page it was picked on.
  const [dockPick, setDockPick] = useState(null);
  const { data: me, isLoading, isError } = useGetMeQuery();
  useSelfLook(me);
  // Team members (not owners, admins) get sidebar, icons-only or glass.
  const layout = me && !["owner", "admin"].includes(me.role) && ["modern", "dock", "launcher"].includes(picked) ? "sidebar" : picked;
  const modern = ["modern", "glass", "dock", "launcher"].includes(layout);
  const navCls = `nav ${layout === "rail" ? "nav-rail" : modern ? "nav-sidebar nav-modern" : "nav-sidebar"}`;
  const shellCls = modern ? `shell shell-modern${layout === "glass" ? " shell-glass" : ""}` : "shell";
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const review = useGetReviewQueueQuery(undefined, { skip: !me || ["representative", "doubtSolver", "teacher", "grader"].includes(me.role) });
  // Same roles as Review's own query — quality checks are the same
  // admin/teacher-facing AI surface, and this is the sidebar badge for the
  // permanent audit queue (AuditQueue.jsx) rather than any one run.
  const openAudits = useGetOpenAuditsQuery(undefined, { skip: !me || ["representative", "doubtSolver", "teacher", "grader"].includes(me.role) });
  const referrals = useGetPendingReferralsQuery(undefined, { skip: !me || ["teacher", "doubtSolver", "representative", "grader"].includes(me.role) });
  // How many submissions are waiting on this account specifically — same
  // list Grading.jsx itself shows, just counted here for the nav badge
  // (point 8 of the spec). Every grading-capable role gets this; only
  // representative and doubtSolver never touch grading at all.
  const deletionCounts = useGetDeletionCountsQuery(undefined, { skip: !me || !["owner", "admin"].includes(me.role), pollingInterval: 600000 });
  const conductCounts = useGetConductCountsQuery(undefined, { skip: !me || !["owner", "admin"].includes(me.role), pollingInterval: 300000 });
  const supportCounts = useGetTicketCountsQuery(undefined, { skip: !me || !["owner", "admin", "teacher"].includes(me.role), pollingInterval: 120000 });
  const agentStatus = useGetAgentStatusQuery(undefined, { skip: !me || !["owner", "admin"].includes(me.role), pollingInterval: 60000 });
  const gradingQueue = useGetGradingQueueQuery(undefined, { skip: !me || ["representative", "doubtSolver"].includes(me.role) });
  // Doubts, leads, hand-ins and recordings waiting, and which pages have
  // something new since this person last opened them.
  const managers = ["owner", "admin"].includes(me?.role);
  const alertsOn = me?.prefs?.alerts !== false;
  const badges = useGetBadgesQuery(undefined, { skip: !me || me.role === "representative", pollingInterval: 60000, skipPollingIfUnfocused: !alertsOn });
  const extra = badges.data?.counts || {};
  // Each role's new work, for the alert.
  const work = !me ? null
    : managers ? null
    : ["grader", "teacher"].includes(me.role) ? { n: gradingQueue.data?.total, title: () => "New scripts to mark", body: (c) => `${c} waiting.`, link: "grading" }
    : me.role === "doubtSolver" ? { n: extra.doubts, title: () => "New doubts", body: (c) => `${c} waiting.`, link: "doubts" }
    : null;
  useNewWorkAlert(work?.n, Boolean(work), { ...(work || {}), prefs: me?.prefs });
  const newDot = (key) => (hasNew(badges.data, key) ? <span className="nav-new" title="New since you last looked" /> : null);

  if (isLoading) return <Loading label="Signing you in" />;
  if (isError || !me) return null; // the base query has already redirected

  const can = useCan(me);

  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  // A representative gets a genuinely different, minimal shell rather than
  // the normal one with everything filtered out — the standard NAV array
  // is built for staff who move between many sections, and running it
  // through the same roles-filter that hides "Earnings" or "Doubts" from
  // one role would still be one more place someone has to remember this
  // role exists and behaves differently. A separate small render here
  // means there is nothing to accidentally leave unfiltered: there is
  // only one link, ever, for this role.
  //
  // This is a UI convenience, not the security boundary — the backend's
  // representativeGate is what actually stops every other API call
  // regardless of what renders here. Even if this shell had a bug, it
  // could only show a broken link to a page that 403s, never leak data.
  if (me.role === "representative") {
    return (
      <ConfirmProvider>
        <div className={shellCls}>
          <nav className={navCls}>
            <NavBrand />
            <HomeLink />

            <NavLink to="/my-coupons" className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="My coupon performance">
              <span className="nav-icon"><Tag size={17} strokeWidth={1.9} /></span>
              <span className="nav-label grow">My coupons</span>
            </NavLink>
            <MyPayslipsLink />
            <ProfileLink />

            <div style={{ flex: 1 }} />

            <button className="nav-item" onClick={signOut} title="Sign out">
              <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
              <span className="nav-label">Sign out</span>
            </button>
          </nav>

          <main className="main">
            {modern && <TopBar items={[...OWN, { to: "/my-coupons", label: "My coupons", Icon: Tag }, { to: "/my-payslips", label: "My payslips", Icon: Wallet }, PROFILE]} me={me} onSignOut={signOut} />}
            {/* The nav link only ever points one place, but this role can
                still land elsewhere — a bookmark, a stale link, or just
                typing a path — since the backend's own gate is what
                actually stops the data, not this redirect. This is the UI
                half of that: send them back rather than show a page that
                is guaranteed to render nothing but 403s. */}
            {ownPage(location.pathname) || location.pathname === "/my-coupons" || location.pathname === "/my-payslips"
              ? <PageOutlet context={{ me, can }} />
              : <Navigate to="/" replace />}
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  // Same shape as representative above — a doubt solver's entire admin
  // panel is one page. Unlike representative, that one page (DoubtQueue)
  // is genuinely multi-purpose (queue, own history, payment stats) rather
  // than a single flat view, but it is still exactly one route, and the
  // backend's restrictedRoleGate is what actually enforces the boundary —
  // this redirect only stops a stray link from showing a page that would
  // otherwise render nothing but 403s.
  if (me.role === "doubtSolver") {
    return (
      <ConfirmProvider>
        <div className={shellCls}>
          <nav className={navCls}>
            <NavBrand />
            <HomeLink />

            <NavLink to="/doubts" className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="Doubt panel">
              <span className="nav-icon"><HelpCircle size={17} strokeWidth={1.9} /></span>
              <span className="nav-label grow">Doubts</span>
              {extra.doubts > 0 && newDot("doubts")}
              {extra.doubts > 0 && <span className="nav-badge tnum">{extra.doubts}</span>}
            </NavLink>
            <MyPayslipsLink />
            <ProfileLink />

            <div style={{ flex: 1 }} />

            <button className="nav-item" onClick={signOut} title="Sign out">
              <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
              <span className="nav-label">Sign out</span>
            </button>
          </nav>

          <main className="main">
            {modern && <TopBar items={[...OWN, { to: "/doubts", label: "Doubts", Icon: HelpCircle }, { to: "/my-payslips", label: "My payslips", Icon: Wallet }, PROFILE]} me={me} onSignOut={signOut} />}
            {ownPage(location.pathname) || location.pathname === "/doubts" || location.pathname === "/my-payslips"
              ? <PageOutlet context={{ me, can }} />
              : <Navigate to="/" replace />}
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  // A teacher gets three destinations, not one — Batches (their own
  // assignments only), Grading (same), and Doubts (identical in every way
  // to doubtSolver's own view, not a teacher-flavored variant). Still a
  // separate small shell rather than the standard NAV run through a roles
  // filter, same reasoning as representative and doubtSolver above: one
  // place to look, nothing to accidentally leave unfiltered. The backend's
  // restrictedRoleGate is what actually enforces the boundary — this is
  // only what renders, and what a stray link outside these three gets
  // bounced back from.
  if (me.role === "teacher") {
    const teacherNav = [
      { to: "/batches", label: terms.Batches, Icon: GraduationCap },
      { to: "/live-classes", label: "My classes", Icon: Video },
      { to: "/grading", label: "Grading", Icon: PenLine, badge: gradingQueue.data?.total || 0, key: "grading" },
      { to: "/grading/assignments", label: "Assignments", Icon: ClipboardCheck, badge: extra.assignments || 0, key: "assignments" },
      { to: "/grading/gradebook", label: "Gradebook", Icon: BookOpenCheck },
      { to: "/grading/offline-marks", label: "Offline marks", Icon: ClipboardList },
      { to: "/grading/certificates", label: "Certificates", Icon: Award },
      { to: "/grading/progress-reports", label: "Progress reports", Icon: Send },
      { to: "/doubts", label: "Doubts", Icon: HelpCircle, badge: extra.doubts || 0, key: "doubts" },
      { to: "/support", label: "Support", Icon: LifeBuoy, badge: supportCounts.data?.open || 0, key: "support" },
      { to: "/my-payslips", label: "My payslips", Icon: Wallet },
    ];
    const isAllowed = ownPage(location.pathname) || teacherNav.some((item) => location.pathname.startsWith(item.to));

    return (
      <ConfirmProvider>
        <div className={shellCls}>
          <nav className={navCls}>
            <NavBrand />
            <HomeLink />

            {teacherNav.map(({ to, label, Icon, badge, key }) => (
              <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive, to, location)} title={label}>
                <span className="nav-icon"><Icon size={17} strokeWidth={1.9} /></span>
                <span className="nav-label grow">{label}</span>
                {badge > 0 && key && newDot(key)}
                {badge > 0 && <span className="nav-badge tnum">{badge}</span>}
              </NavLink>
            ))}
            <ProfileLink />

            <div style={{ flex: 1 }} />

            <button className="nav-item" onClick={signOut} title="Sign out">
              <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
              <span className="nav-label">Sign out</span>
            </button>
          </nav>

          <main className="main">
            {modern && <TopBar items={[...OWN, ...teacherNav, PROFILE]} me={me} onSignOut={signOut} />}
            <IngestJobs />
            {isAllowed
              ? <PageOutlet context={{ me, can }} />
              : <Navigate to="/" replace />}
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  // A grader gets exactly one destination — narrower even than doubtSolver's
  // one page, because unlike DoubtQueue this role shares that single page
  // (Grading.jsx) with teacher rather than getting one of its own; the
  // backend anonymizes what it returns based on role (see
  // gradingController.js's shapeStudentFor), so the same component just
  // renders less for this account. Same rationale as every other minimal
  // shell above: this redirect is only what renders, restrictedRoleGate is
  // what actually enforces the boundary.
  if (me.role === "grader") {
    const count = gradingQueue.data?.total || 0;
    return (
      <ConfirmProvider>
        <div className={shellCls}>
          <nav className={navCls}>
            <NavBrand />
            <HomeLink />

            <NavLink to="/grading" className={({ isActive }) => navClass(isActive, "/grading", location)} title="Grading">
              <span className="nav-icon"><PenLine size={17} strokeWidth={1.9} /></span>
              <span className="nav-label grow">Grading</span>
              {count > 0 && newDot("grading")}
              {count > 0 && <span className="nav-badge tnum">{count}</span>}
            </NavLink>

            <NavLink to="/grading/assignments" className={({ isActive }) => `nav-item${isActive ? " nav-item-on" : ""}`} title="Assignments">
              <span className="nav-icon"><ClipboardCheck size={17} strokeWidth={1.9} /></span>
              <span className="nav-label grow">Assignments</span>
              {extra.assignments > 0 && newDot("assignments")}
              {extra.assignments > 0 && <span className="nav-badge tnum">{extra.assignments}</span>}
            </NavLink>
            <MyPayslipsLink />
            <ProfileLink />

            <div style={{ flex: 1 }} />

            <button className="nav-item" onClick={signOut} title="Sign out">
              <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
              <span className="nav-label">Sign out</span>
            </button>
          </nav>

          <main className="main">
            {modern && <TopBar items={[...OWN, { to: "/grading", label: "Grading", Icon: PenLine }, { to: "/grading/assignments", label: "Assignments", Icon: ClipboardCheck }, { to: "/my-payslips", label: "My payslips", Icon: Wallet }, PROFILE]} me={me} onSignOut={signOut} />}
            {ownPage(location.pathname) || location.pathname === "/grading" || location.pathname.startsWith("/grading/") || location.pathname === "/my-payslips"
              ? <PageOutlet context={{ me, can }} />
              : <Navigate to="/" replace />}
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  const staffNav = NAV.filter((item) => (!item.admin || can("manageTeam")) && (!item.roles || item.roles.includes(me.role)))
    // A group header with none of its links left for this role goes too.
    .filter((item, i, list) => item.group === undefined || (list[i + 1] && list[i + 1].group === undefined))
    .map((x) => (x.to === "/batches" ? { ...x, label: terms.Batches } : x));
  const staffLinks = staffNav.filter((x) => x.to);

  // Two separate queues share the review badge — pending questions and
  // pending solutions. Counting only the first meant the badge read zero,
  // or undercounted, whenever a run had produced solutions waiting on
  // review but no new questions to go with them.
  const countOf = (item) => (item.badge === "review"
    ? (review.data?.total || 0) + (review.data?.solutionsTotal || 0)
    : item.badge === "referrals"
      ? (referrals.data?.total || 0)
      : item.badge === "grading"
        ? (gradingQueue.data?.total || 0)
        : item.badge === "audits"
          ? (openAudits.data?.openItemsTotal || 0)
          : item.badge === "support"
            ? (supportCounts.data?.open || 0)
            : item.badge === "conduct"
              ? (conductCounts.data?.open || 0)
              : item.badge === "deletions"
                ? (deletionCounts.data?.awaiting || 0)
                : item.badge === "agents"
                  ? (agentStatus.data?.waiting || 0)
                  : item.badge === "doubts"
                    ? (extra.doubts || 0) + (extra.doubtReviews || 0)
                    : item.badge ? extra[item.badge] || 0 : 0);

  const navLink = (item) => {
    const { Icon } = item;
    const count = countOf(item);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => navClass(isActive, item.to, location)}
        title={item.label}
      >
        <span className="nav-icon"><Icon size={17} strokeWidth={1.9} /></span>
        <span className="nav-label grow">{item.label}</span>
        {item.badge === "grading" && gradingQueue.data?.stuck > 0 && (
          <span className="nav-badge tnum" title={`${gradingQueue.data.stuck} part-marked script${gradingQueue.data.stuck === 1 ? "" : "s"} stuck`} style={{ background: "var(--incorrect)", color: "#fff" }}>!{gradingQueue.data.stuck}</span>
        )}
        {count > 0 && newDot(item.badge)}
        {count > 0 && <span className="nav-badge tnum">{count}</span>}
      </NavLink>
    );
  };

  const signOutButton = (
    <button className="nav-item" onClick={signOut} title="Sign out">
      <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
      <span className="nav-label">Sign out</span>
    </button>
  );

  // Launcher: no sidebar; the overview opens on every page as a tile.
  if (layout === "launcher") {
    return (
      <ConfirmProvider>
        <div className="shell shell-launcher">
          <main className="main">
            <TopBar items={staffLinks} me={me} onSignOut={signOut} home />
            <IngestJobs />
            {location.pathname === "/" && <Launcher me={me} sections={sectionsOf(staffNav)} countOf={countOf} />}
            <PageOutlet context={{ me, can }} />
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  // Dock: a strip of section icons, and the open section's pages beside it.
  // The open section follows the page, unless one was picked on this page.
  if (layout === "dock") {
    const sections = sectionsOf(staffNav);
    const here = matchPage(staffLinks, location.pathname);
    const routeSection = sections.find((sec) => sec.items.includes(here))?.name || sections[0]?.name;
    const open = dockPick && dockPick.at === location.pathname ? dockPick.name : routeSection;
    const section = sections.find((sec) => sec.name === open) || sections[0];
    return (
      <ConfirmProvider>
        <div className="shell shell-modern shell-dock">
          <DockRail sections={sections} open={section?.name} countOf={countOf}
            onPick={(sec) => (sec.items.length === 1 ? navigate(sec.items[0].to) : setDockPick({ name: sec.name, at: location.pathname }))}
            onSignOut={signOut} />
          {section && section.items.length > 1 && (
            <nav className="nav nav-sidebar nav-modern dock-panel">
              <div className="dock-panel-title">{section.name}</div>
              {section.items.map(navLink)}
            </nav>
          )}
          <main className="main">
            <TopBar items={staffLinks} me={me} onSignOut={signOut} />
            <IngestJobs />
            <PageOutlet context={{ me, can }} />
          </main>
        </div>
      </ConfirmProvider>
    );
  }

  return (
    <ConfirmProvider>
    <div className={shellCls}>
      <nav className={navCls}>
        <NavBrand />

        {staffNav.map((item, index) => (item.group !== undefined
          ? <div className="nav-group" key={`g${index}`}>{item.group}</div>
          : navLink(item)))}

        <div style={{ flex: 1 }} />

        {signOutButton}
      </nav>

      <main className="main">
        {modern && <TopBar items={staffLinks} me={me} onSignOut={signOut} />}
        <IngestJobs />
        <PageOutlet context={{ me, can }} />
      </main>
    </div>
    </ConfirmProvider>
  );
}
