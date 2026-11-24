import { useRef, useState } from "react";
import { Avatar, Box, Chip, Container, Dialog, IconButton, Typography } from "@mui/material";
import SafeMarkdown from "./SafeMarkdown";
import { X, GraduationCap, Award, ChevronLeft, ChevronRight } from "lucide-react";

// Teachers' public profiles (backend utils/teacherProfile.js): photo, name,
// headline, subjects, qualifications, years teaching and a bio. Shown on
// the landing page, in a batch's details and on its home page. Tapping a
// teacher opens their full profile.

const initials = (name = "") => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function TeacherAvatar({ teacher, size = 40 }) {
  return (
    <Avatar src={teacher.photo || undefined} alt={teacher.name} sx={{ width: size, height: size, fontSize: size * 0.38, bgcolor: "primary.main", color: "primary.contrastText" }}>
      {initials(teacher.name)}
    </Avatar>
  );
}

// The bio is Markdown; a short preview shows it as plain text.
const plain = (md = "") => md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`~-]+/g, " ").replace(/\s+/g, " ").trim();

const years = (n) => (n ? `${n} year${n === 1 ? "" : "s"} teaching` : "");

export function TeacherDialog({ teacher, onClose }) {
  if (!teacher) return null;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box sx={{ p: 3, position: "relative" }}>
        <IconButton size="small" onClick={onClose} sx={{ position: "absolute", top: 10, right: 10 }}><X size={16} /></IconButton>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, mb: 2 }}>
          <TeacherAvatar teacher={teacher} size={104} />
          <Typography sx={{ fontWeight: 600, fontSize: 19, mt: 1 }}>{teacher.name}</Typography>
          {teacher.headline && <Typography variant="body2" color="text.secondary">{teacher.headline}</Typography>}
        </Box>
        {teacher.subjects?.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", justifyContent: "center", mb: 2 }}>
            {teacher.subjects.map((s) => <Chip key={s} size="small" label={s} variant="outlined" />)}
          </Box>
        )}
        {(teacher.qualifications || teacher.experienceYears) && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 2 }}>
            {teacher.qualifications && (
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <GraduationCap size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <Typography variant="body2">{teacher.qualifications}</Typography>
              </Box>
            )}
            {teacher.experienceYears ? (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Award size={16} style={{ flexShrink: 0 }} />
                <Typography variant="body2">{years(teacher.experienceYears)}</Typography>
              </Box>
            ) : null}
          </Box>
        )}
        {teacher.bio && <Box sx={{ fontSize: 14, lineHeight: 1.6 }}><SafeMarkdown>{teacher.bio}</SafeMarkdown></Box>}
      </Box>
    </Dialog>
  );
}

// A compact row for a batch: avatar, name and headline per teacher.
export function TeacherStrip({ teachers = [], label = "Teachers", sx }) {
  const [open, setOpen] = useState(null);
  if (!teachers.length) return null;
  return (
    <Box sx={sx}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, fontWeight: 500 }}>{label}</Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {teachers.map((t) => (
          <Box
            key={t._id}
            role="button"
            tabIndex={0}
            onClick={() => setOpen(t)}
            onKeyDown={(e) => e.key === "Enter" && setOpen(t)}
            sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1.5, pl: 0.5, py: 0.5, borderRadius: 99, border: 1, borderColor: "divider", cursor: "pointer", maxWidth: "100%", "&:hover": { bgcolor: "action.hover" } }}
          >
            <TeacherAvatar teacher={t} size={32} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500, lineHeight: 1.2 }}>{t.name}</Typography>
              {t.headline && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", lineHeight: 1.2 }}>{t.headline}</Typography>}
            </Box>
          </Box>
        ))}
      </Box>
      <TeacherDialog teacher={open} onClose={() => setOpen(null)} />
    </Box>
  );
}

function TeacherCard({ teacher, onOpen }) {
  return (
    <Box
      className="examai-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(teacher)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(teacher)}
      sx={{ borderRadius: 3, bgcolor: "background.paper", p: 2.5, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 0.75, cursor: "pointer", transition: "transform .15s", "&:hover": { transform: "translateY(-2px)" } }}
    >
      <TeacherAvatar teacher={teacher} size={96} />
      <Typography sx={{ fontWeight: 600, mt: 1 }}>{teacher.name}</Typography>
      {teacher.headline && <Typography variant="body2" color="text.secondary">{teacher.headline}</Typography>}
      {teacher.experienceYears ? <Typography variant="caption" color="text.secondary">{years(teacher.experienceYears)}</Typography> : null}
      {teacher.subjects?.length > 0 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", justifyContent: "center", mt: 0.5 }}>
          {teacher.subjects.slice(0, 4).map((s) => <Chip key={s} size="small" label={s} variant="outlined" />)}
        </Box>
      )}
    </Box>
  );
}

function TeacherRow({ teacher, onOpen }) {
  return (
    <Box
      className="examai-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(teacher)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(teacher)}
      sx={{ borderRadius: 3, bgcolor: "background.paper", p: 2, display: "flex", gap: 2, alignItems: "flex-start", cursor: "pointer" }}
    >
      <TeacherAvatar teacher={teacher} size={72} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600 }}>{teacher.name}</Typography>
        {teacher.headline && <Typography variant="body2" color="text.secondary">{teacher.headline}</Typography>}
        {(teacher.qualifications || teacher.experienceYears) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {[teacher.qualifications, years(teacher.experienceYears)].filter(Boolean).join(" · ")}
          </Typography>
        )}
        {teacher.bio && (
          <Typography variant="body2" sx={{ mt: 0.75, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {plain(teacher.bio)}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// The landing page's teachers section. content.teachersLayout: "grid" |
// "carousel" | "list".
export function TeachersSection({ content = {}, teachers = [] }) {
  const [open, setOpen] = useState(null);
  const strip = useRef(null);
  if (!teachers.length) return null;
  const layout = content.teachersLayout || "grid";
  const scroll = (dir) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.9, behavior: "smooth" });

  let body;
  if (layout === "list") {
    body = (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
        {teachers.map((t) => <TeacherRow key={t._id} teacher={t} onOpen={setOpen} />)}
      </Box>
    );
  } else if (layout === "carousel") {
    body = (
      <Box>
        <Box ref={strip} sx={{ display: "flex", gap: 2, overflowX: "auto", scrollSnapType: "x mandatory", pb: 1, "&::-webkit-scrollbar": { display: "none" } }}>
          {teachers.map((t) => (
            <Box key={t._id} sx={{ flex: { xs: "0 0 72%", sm: "0 0 42%", md: "0 0 23.5%" }, scrollSnapAlign: "start" }}>
              <TeacherCard teacher={t} onOpen={setOpen} />
            </Box>
          ))}
        </Box>
        {teachers.length > 4 && (
          <Box sx={{ display: { xs: "none", md: "flex" }, justifyContent: "center", gap: 1, mt: 2 }}>
            <IconButton onClick={() => scroll(-1)} sx={{ border: 1, borderColor: "divider" }}><ChevronLeft size={18} /></IconButton>
            <IconButton onClick={() => scroll(1)} sx={{ border: 1, borderColor: "divider" }}><ChevronRight size={18} /></IconButton>
          </Box>
        )}
      </Box>
    );
  } else {
    body = (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)" }, gap: { xs: 1.5, md: 2.5 } }}>
        {teachers.map((t) => <TeacherCard key={t._id} teacher={t} onOpen={setOpen} />)}
      </Box>
    );
  }

  return (
    <Box sx={{ py: { xs: 6, md: 10 } }}>
      <Container maxWidth="lg">
        <Box sx={{ textAlign: "center", mb: { xs: 3, md: 5 } }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>{content.heading || "Meet our teachers"}</Typography>
          {content.subheading && <Typography color="text.secondary" sx={{ mt: 1 }}>{content.subheading}</Typography>}
        </Box>
        {body}
      </Container>
      <TeacherDialog teacher={open} onClose={() => setOpen(null)} />
    </Box>
  );
}
