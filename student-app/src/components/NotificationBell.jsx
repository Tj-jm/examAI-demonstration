import { useState, useEffect } from "react";
import {
  IconButton, Badge, Popover, Box, Typography, Button, Skeleton, Divider, Chip,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import {
  Bell, CheckCheck, Megaphone, HelpCircle, GraduationCap, X, CalendarCheck, Ban, AlarmClock, RotateCcw,
  Video, LifeBuoy, ShieldAlert, UserX, Zap, HeartHandshake, ClipboardList, ClipboardCheck, Award, Gift, Send } from "lucide-react";
import {
  useGetNotificationsQuery, useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation,
} from "../api/contentApi";

const TYPE_ICON = {
  doubtResolved: HelpCircle,
  examGraded: GraduationCap,
  assignmentNew: ClipboardList,
  assignmentGraded: ClipboardCheck,
  certificateIssued: Award,
  referralReward: Gift,
  campaign: Send,
  assignmentReminder: ClipboardList,
  examReview: RotateCcw,
  newNotice: Megaphone,
  liveClassScheduled: Video,
  liveClassMissed: Video,
  studyNudge: HeartHandshake,
  studyPlanReady: CalendarCheck,
  studyPlanDayDone: CalendarCheck,
  examDisqualified: Ban,
  examReminder: AlarmClock,
  ticketReply: LifeBuoy,
  accountStanding: ShieldAlert,
  accountDeletion: UserX,
  aiCredits: Zap,
};
// Shown in the warning colour, so they stand out in the list.
const URGENT = new Set(["accountStanding", "accountDeletion", "examDisqualified"]);

const FILTERS = [["", "All"], ["unread", "Unread"], ["important", "Important"]];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// No relative-time library anywhere else in this app, so this stays a
// small hand-rolled version rather than a new dependency for one label —
// same reasoning as the homepage carousel skipping a carousel library.
const timeAgo = (iso) => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

// Polling rather than a websocket — nothing else in this codebase runs a
// realtime layer, and none of the three event types behind this (a doubt
// answered, an exam graded, a notice posted) need sub-second delivery. A
// half-minute of staleness on an unread badge costs nothing a student would
// notice.
const POLL_MS = 30000;

export default function NotificationBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);

  const { data: countData } = useGetUnreadNotificationCountQuery(undefined, { pollingInterval: POLL_MS });
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [older, setOlder] = useState([]); // pages after the first, kept while open
  const { data, isLoading, isFetching } = useGetNotificationsQuery({ page, filter }, { skip: !open });
  useEffect(() => {
    if (!data) return;
    if (data.page === 1) setOlder([]);
    else {
      // Refreshed items replace themselves in place; new ones go last.
      setOlder((prev) => {
        const fresh = new Map(data.notifications.map((n) => [n._id, n]));
        const kept = prev.map((n) => fresh.get(n._id) || n);
        return [...kept, ...data.notifications.filter((n) => !prev.some((p) => p._id === n._id))];
      });
    }
  }, [data]);
  const switchFilter = (value) => {
    setFilter(value);
    setPage(1);
    setOlder([]);
  };
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();
  const [deleteNotification] = useDeleteNotificationMutation();

  const unreadCount = countData?.unreadCount || 0;
  const firstPage = page === 1 ? data?.notifications || [] : [];
  const notifications = page === 1 ? firstPage : older;
  const today = startOfToday();
  const groups = [
    ["Today", notifications.filter((n) => new Date(n.createdAt).getTime() >= today)],
    ["Earlier", notifications.filter((n) => new Date(n.createdAt).getTime() < today)],
  ].filter(([, list]) => list.length);

  const openOne = (notification) => {
    if (!notification.isRead) markRead(notification._id);
    setAnchor(null);
    if (notification.link) navigate(notification.link);
  };

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Notifications">
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <Bell size={18} />
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ width: 340, maxWidth: "90vw" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", p: 1.5 }}>
            <Typography sx={{ fontWeight: 500, fontSize: 14 }}>Notifications</Typography>
            {unreadCount > 0 && (
              <Button
                size="small"
                startIcon={<CheckCheck size={14} />}
                onClick={() => markAllRead()}
                sx={{ textTransform: "none", fontSize: 12.5 }}
              >
                Mark all read
              </Button>
            )}
          </Box>
          <Box sx={{ display: "flex", gap: 0.75, px: 1.5, pb: 1.25 }}>
            {FILTERS.map(([value, label]) => (
              <Chip
                key={value || "all"}
                size="small"
                label={label}
                color={filter === value ? "primary" : "default"}
                variant={filter === value ? "filled" : "outlined"}
                onClick={() => switchFilter(value)}
              />
            ))}
          </Box>
          <Divider />

          <Box sx={{ maxHeight: 440, overflowY: "auto" }}>
            {isLoading ? (
              <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={56} />)}
              </Box>
            ) : notifications.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Bell size={22} style={{ opacity: 0.3, marginBottom: 8 }} />
                <Typography variant="body2" color="text.secondary">{filter ? "Nothing here." : "Nothing here yet."}</Typography>
              </Box>
            ) : (
              groups.map(([label, list]) => [
                <Typography key={label} variant="caption" color="text.secondary" sx={{ display: "block", px: 1.5, pt: 1.25, pb: 0.5, fontWeight: 600 }}>
                  {label}
                </Typography>,
                ...list.map((n) => {
                const Icon = TYPE_ICON[n.type] || Bell;
                return (
                  <Box
                    key={n._id}
                    onClick={() => openOne(n)}
                    sx={{
                      display: "flex", gap: 1.25, p: 1.5, cursor: "pointer",
                      bgcolor: n.isRead ? "transparent" : "action.hover",
                      "&:hover": { bgcolor: "action.selected" },
                      borderBottom: 1, borderColor: "divider",
                    }}
                  >
                    <Box sx={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      bgcolor: URGENT.has(n.type) ? "warning.main" : "action.hover",
                      color: URGENT.has(n.type) ? "warning.contrastText" : "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon size={15} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: n.isRead ? 400 : 600, lineHeight: 1.3 }}>
                        {n.title}
                      </Typography>
                      {n.body && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "-webkit-box", mt: 0.25, WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {n.body}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, opacity: 0.7 }}>
                        {timeAgo(n.createdAt)}
                      </Typography>
                    </Box>
                    {/* Delete only appears once read — an unread item still
                        carries the blue dot in this same spot, and deleting
                        something unseen skips past reading it entirely,
                        which read-then-clear is meant to prevent. */}
                    {!n.isRead && (
                      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0, mt: 0.75 }} />
                    )}
                    {n.isRead && (
                      <IconButton
                        size="small"
                        aria-label="Delete notification"
                        onClick={(e) => { e.stopPropagation(); deleteNotification(n._id); }}
                        sx={{ flexShrink: 0, alignSelf: "flex-start", ml: -0.5 }}
                      >
                        <X size={14} />
                      </IconButton>
                    )}
                  </Box>
                );
                }),
              ])
            )}
            {data && data.page < data.pages && (
              <Box sx={{ p: 1, textAlign: "center" }}>
                <Button
                  size="small"
                  disabled={isFetching}
                  onClick={() => {
                    if (page === 1) setOlder(firstPage);
                    setPage(page + 1);
                  }}
                >
                  {isFetching ? "Loading…" : "Show older"}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Popover>
    </>
  );
}
