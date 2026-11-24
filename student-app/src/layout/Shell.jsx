import { useState, useRef, useEffect, createContext, useContext } from "react";
import MascotHost from "../components/Mascot";
import {
  AppBar, Toolbar, Box, Typography, Avatar, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText,
  Paper, IconButton, Menu, MenuItem, useMediaQuery,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import {
  Home, PlayCircle, PenLine, Trophy, Wallet, LogOut, Sun, Moon, Monitor,
  Dumbbell, LifeBuoy, UserCog, Award,
  ALargeSmall,
} from "lucide-react";
import { useGetSupportUnreadQuery } from "../api/accountApi";
import { useSales, useBranding } from "../BrandingContext";
import { TEXT_SIZES, getTextSize, setTextSize } from "../utils/textSize";
import { RESTRAINED_DESIGNS, getBoldFill } from "../theme/buildTheme";
import { useLogoutMutation, useLazyGetMeQuery } from "../api/authApi";
import NotificationBell from "../components/NotificationBell";
import PullToRefresh from "../native/PullToRefresh";

const NAV = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/lectures", label: "Lectures", Icon: PlayCircle },
  { to: "/practice", label: "Practice", Icon: Dumbbell },
  { to: "/exams", label: "Exams", Icon: PenLine },
  { to: "/results", label: "Results", Icon: Trophy },
  { to: "/purchases", label: "Plans", Icon: Wallet },
];
// Without sales (a school that doesn't charge here) there's no Plans tab.
// Plans is last, so the other tabs keep their positions.
const useNav = () => {
  const sales = useSales();
  return sales ? NAV : NAV.filter((n) => n.to !== "/purchases");
};
// Archive is deliberately NOT here — it's a per-batch module (like Doubts/
// Live classes/Study plan), reached from BatchHome, not a global tab.

// One shell, two arrangements — which one renders is an institution-wide
// setting (studentUi.layout), not a per-student choice, so this reads it
// from context rather than local state. The mode toggle IS per-student,
// gated by allowModeOverride from the same setting.
//
// "adaptive" is the one case that isn't a fixed pick: it asks the viewport
// instead of the setting. 900px is MUI's own "md" breakpoint — wide enough
// that a sidebar has room to sit beside content rather than crowd it, same
// cutoff the rest of this codebase would reach for by default. This still
// reads institution-wide "app"/"web" literally, same as before — adaptive
// is opt-in, not a replacement for someone who wants one look forced.
// Which of the two layouts a page is inside — "app" (480px column, fixed
// bottom tabs) or "web" (sidebar). A page that sizes itself to the screen,
// like course chat, must ask this rather than the viewport: the app layout
// stays 480px wide on a desktop screen too.
const LayoutModeContext = createContext("web");
export const useLayoutMode = () => useContext(LayoutModeContext);

export default function Shell({ me, children }) {
  const branding = useBranding();
  const isWideEnoughForWeb = useMediaQuery("(min-width:900px)");
  const isWeb = branding.layout === "adaptive" ? isWideEnoughForWeb : branding.layout === "web";
  return (
    <LayoutModeContext.Provider value={isWeb ? "web" : "app"}>
      {isWeb
        ? <WebLayout me={me}>{children}</WebLayout>
        : <AppLayout me={me}>{children}</AppLayout>}
      {branding.mascot && <MascotHost mascot={branding.mascot} bottom={isWeb ? 24 : "calc(84px + env(safe-area-inset-bottom))"} top={isWeb ? 0 : { xs: 56, sm: 64 }} />}
    </LayoutModeContext.Provider>
  );
}

function Logo() {
  const branding = useBranding();
  const editorial = RESTRAINED_DESIGNS.has(branding.design);
  const theme = useTheme();
  // Same reasoning as PaymentShell's bar — this square stays colored for
  // every design, restrained ones included, so it's unconditional; a
  // restrained design falls to getBoldFill's flat-accent default, which is
  // exactly what this drew before.
  const fill = getBoldFill(branding.design, theme);

  if (branding.logo) {
    return <Box component="img" src={branding.logo} alt={branding.siteName} sx={{ height: 28 }} />;
  }
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Box sx={{
        width: 26, height: 26, flexShrink: 0,
        borderRadius: editorial ? 0.5 : 1,
        background: fill.background,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Typography sx={{ color: fill.color, fontSize: 13 }}>{branding.siteName[0]}</Typography>
      </Box>
      {/* variant="h6" is what actually picks up the design's heading font
          from the theme (buildTheme.js only overrides h1–h6) — a plain,
          variant-less Typography here would stay in the body font
          regardless of design and the wordmark would never look editorial. */}
      <Typography variant="h6" sx={{ fontSize: 16 }}>{branding.siteName}</Typography>
    </Box>
  );
}

function ModeMenu() {
  const branding = useBranding();
  const [anchor, setAnchor] = useState(null);
  if (!branding.allowModeOverride) return null;

  const options = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Monitor]];
  const current = options.find(([v]) => v === branding.mode) || options[0];
  const CurrentIcon = current[2];

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <CurrentIcon size={18} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {options.map(([value, label, Icon]) => (
          <MenuItem key={value} selected={branding.mode === value} onClick={() => { branding.setMode(value); setAnchor(null); }}>
            <ListItemIcon><Icon size={16} /></ListItemIcon>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

// Text size, per student and per device (utils/textSize.js).
function TextSizeMenu() {
  const [anchor, setAnchor] = useState(null);
  const [size, setSize] = useState(getTextSize);
  return (
    <>
      <IconButton size="small" title="Text size" onClick={(e) => setAnchor(e.currentTarget)}>
        <ALargeSmall size={18} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {TEXT_SIZES.map(([value, label, scale]) => (
          <MenuItem key={value} selected={size === value} onClick={() => { setTextSize(value); setSize(value); setAnchor(null); }}>
            <span style={{ fontSize: Math.round(14 * scale) }}>{label}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

// `variant="full"` is the sidebar footer's own trigger — avatar, name and
// email all visible rather than hidden behind an icon, since the drawer
// footer already has a full row's width to spend and reusing the icon
// trigger there just duplicated the avatar already shown next to the name
// (WebLayout used to render both). AppLayout's top bar stays on the default
// icon-only trigger — there, that width isn't available.
function AccountMenu({ me, variant = "icon" }) {
  const [anchor, setAnchor] = useState(null);
  const [logout] = useLogoutMutation();
  const [refetchMe] = useLazyGetMeQuery();
  const navigate = useNavigate();
  const { data: supportUnread } = useGetSupportUnreadQuery(undefined, { pollingInterval: 120000 });
  const branding = useBranding();
  const sales = useSales();

  const trigger = variant === "full" ? (
    <Box
      onClick={(e) => setAnchor(e.currentTarget)}
      sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1, cursor: "pointer" }}
    >
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, flexShrink: 0 }}>{(me.name || "?")[0]}</Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500, lineHeight: 1.35 }}>{me.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
          {me.email || me.phoneNumber}
        </Typography>
      </Box>
    </Box>
  ) : (
    <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
      <Avatar sx={{ width: 28, height: 28, fontSize: 13 }}>{(me.name || "?")[0]}</Avatar>
    </IconButton>
  );

  return (
    <>
      {trigger}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled sx={{ opacity: "1 !important" }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{me.name}</Typography>
            <Typography variant="caption" color="text.secondary">{me.email || me.phoneNumber}</Typography>
          </Box>
        </MenuItem>
        <MenuItem onClick={() => { setAnchor(null); navigate("/account"); }}>
          <ListItemIcon><UserCog size={16} /></ListItemIcon>
          Account
        </MenuItem>
        <MenuItem onClick={() => { setAnchor(null); navigate("/certificates"); }}>
          <ListItemIcon><Award size={16} /></ListItemIcon>
          Certificates
        </MenuItem>
        <MenuItem onClick={() => { setAnchor(null); navigate("/support"); }}>
          <ListItemIcon><LifeBuoy size={16} /></ListItemIcon>
          <Box sx={{ flex: 1 }}>Help & support</Box>
          {supportUnread?.count > 0 && (
            <Box sx={{ ml: 1.5, minWidth: 18, height: 18, px: 0.5, borderRadius: 9, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {supportUnread.count}
            </Box>
          )}
        </MenuItem>
        <MenuItem
          onClick={async () => {
            // Close the menu's own Popover/Modal *before* anything async
            // starts, instead of leaving it open while the whole Shell
            // (AppBar, Drawer, this menu) gets torn down underneath it a
            // moment later when `me` flips to null. An open MUI Menu ripped
            // out mid-transition — rather than exiting through its own
            // onClose — is the kind of thing that can leave the page's
            // click-blocking overlay or scroll lock behind, which no amount
            // of in-app navigation clears; only a full reload resets it.
            setAnchor(null);
            await logout();
            // logout()'s invalidatesTags only schedules getMe's refetch in
            // the background — it doesn't wait for it. Without this, the
            // cache can still hold the old (logged-in) `me` for a moment
            // after navigate("/") runs, and RedirectIfAuthed on /login
            // trusts that stale cache and silently bounces the very next
            // click on "Log in" straight back to "/" — the "have to click
            // twice" symptom. Forcing this refetch to actually land before
            // navigating closes that window.
            await refetchMe().catch(() => {});
            navigate("/");
          }}
        >
          <ListItemIcon><LogOut size={16} /></ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}

// Mobile-first: top bar for identity, bottom tabs for navigation — the same
// pattern the reference exam app used, and the one that reads most like a
// habit-forming daily app rather than a desktop tool.
function AppLayout({ me, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The same list the bar draws (Plans and Books come and go).
  const tabs = useNav();
  const current = tabs.findIndex((n) => n.to === location.pathname);

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", bgcolor: "transparent" }}>
      <PullToRefresh />
      <AppBar position="sticky" color="transparent" sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Logo />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <NotificationBell />
            <TextSizeMenu />
            <ModeMenu />
            <AccountMenu me={me} />
          </Box>
        </Toolbar>
      </AppBar>

      {/* Clearance for the fixed bar below: its own content (~56px) plus
          some breathing room, plus the iOS home-indicator safe area, which
          the bar pads itself into (see NAV_BAR_SAFE_PB) — without adding
          that same amount here too, the page's last content sits right up
          against the bar with no visible gap. */}
      <Box sx={{ flex: 1, maxWidth: 480, width: "100%", mx: "auto", pb: `calc(72px + env(safe-area-inset-bottom))` }}>
        {children}
      </Box>

      <BottomNavCarousel current={current === -1 ? 0 : current} onNavigate={(i) => navigate(tabs[i].to)} />
    </Box>
  );
}

// A horizontally-scrolling replacement for MUI's BottomNavigation. That
// component splits its width evenly across every item, so six items (Home
// through Plans) squeezed into a 480px-capped bar left each one too narrow
// on a real phone — labels clipped, icons crowding the screen edges. This
// scrolls instead of squeezing: every item keeps its natural width, and the
// active one is scrolled into view (centered) whenever the route changes,
// so a student landing deep in the list (e.g. on Plans) doesn't have to
// hunt for where they are.
function BottomNavCarousel({ current, onNavigate }) {
  const nav = useNav();
  const theme = useTheme();
  const itemRefs = useRef([]);

  useEffect(() => {
    itemRefs.current[current]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [current]);

  return (
    <Paper
      data-bottom-nav
      elevation={0}
      sx={{
        position: "fixed", bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: "divider", zIndex: 10,
        // The home-indicator inset on notched phones — padding the bar
        // itself into it (rather than leaving it to the OS chrome) is what
        // AppLayout's own pb above is sized to match.
        pb: "env(safe-area-inset-bottom)",
      }}
    >
      <Box
        sx={{
          maxWidth: 480, mx: "auto", bgcolor: "background.paper",
          display: "flex", gap: 0.5, overflowX: "auto",
          px: 1.5, py: 1, scrollSnapType: "x proximity",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
          // Fades the edges so a partially-visible item reads as "more to
          // scroll" rather than as a clipped, broken one.
          maskImage: "linear-gradient(to right, transparent 0, #000 20px, #000 calc(100% - 20px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 20px, #000 calc(100% - 20px), transparent 100%)",
        }}
      >
        {nav.map(({ to, label, Icon }, i) => {
          const active = i === current;
          return (
            <Box
              key={to}
              ref={(el) => (itemRefs.current[i] = el)}
              onClick={() => onNavigate(i)}
              sx={{
                // grow+shrink with a floor, not a fixed size — when all six
                // fit (most phones), this spreads them evenly across the
                // full bar width, same as MUI's BottomNavigation did; only
                // once they can't shrink past 60px does the row start
                // scrolling instead of squeezing further.
                flex: "1 1 68px", minWidth: 60, maxWidth: 96,
                scrollSnapAlign: "center", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 0.4,
                px: 1.75, py: 0.5, borderRadius: 2.5,
                color: active ? "primary.main" : "text.secondary",
                bgcolor: active ? alpha(theme.palette.primary.main, 0.1) : "transparent",
                transition: "background-color 150ms ease, color 150ms ease",
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <Typography sx={{ fontSize: 10.5, fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>
                {label}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

// Sidebar navigation, wider content — a desktop-oriented reading of the
// same information, for institutions that expect students on a laptop as
// often as a phone.
const DRAWER_WIDTH = 220;

function WebLayout({ me, children }) {
  const nav = useNav();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "transparent" }}>
      <Drawer
        variant="permanent"
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", borderRight: 1, borderColor: "divider" } }}
      >
        <Box sx={{ p: 2.5 }}><Logo /></Box>
        <List sx={{ px: 1.5 }}>
          {nav.map(({ to, label, Icon }) => (
            <ListItemButton
              key={to}
              selected={location.pathname === to}
              onClick={() => navigate(to)}
              sx={{ borderRadius: 1.5, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 34 }}><Icon size={17} strokeWidth={1.75} /></ListItemIcon>
              <ListItemText primaryTypographyProps={{ fontSize: 13.5 }}>{label}</ListItemText>
            </ListItemButton>
          ))}
        </List>
        {/* Icons on their own row, identity on the one below — packing both
            plus a second avatar into a single 220px-wide row (the old
            layout) left the name clipped to a couple of characters and the
            icons crowded against the edge. Splitting them gives the name
            its own full-width row and the icons room to breathe. */}
        <Box sx={{ mt: "auto", borderTop: 1, borderColor: "divider" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 1 }}>
            <ModeMenu />
            <TextSizeMenu />
            <NotificationBell />
          </Box>
          <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: "divider" }}>
            <AccountMenu me={me} variant="full" />
          </Box>
        </Box>
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}