import { Box, Chip, Typography } from "@mui/material";
import { FolderOpen } from "lucide-react";

// A batch's named groups of chapters (papers, terms, units), set on its
// outline in the admin panel. Lists that come from the API already arrive
// in the outline's order, each item carrying `group` ({ _id, name } or
// null); these helpers split them into sections and filter by group.

export const OTHER = "other";

// [{ key, title, items }] in the outline's group order; ungrouped items
// last, under "Other" (or untitled when the batch has no groups at all).
export const sectionsByGroup = (items, groups = []) => {
  if (!groups.length) return [{ key: "all", title: null, items }];
  const sections = groups.map((g) => ({ key: g._id, title: g.name, items: [] }));
  const other = { key: OTHER, title: "Other", items: [] };
  for (const item of items) {
    const section = item.group && sections.find((s) => s.key === item.group._id);
    (section || other).items.push(item);
  }
  const shown = [...sections, other].filter((s) => s.items.length);
  // Nothing on this list is grouped: no header needed.
  return shown.length === 1 && shown[0] === other ? [{ ...other, title: null }] : shown;
};

export const inGroup = (item, value) => !value || (value === OTHER ? !item.group : item.group?._id === value);

// "All" plus one chip per group that has something in it.
export function GroupChips({ groups = [], items = [], value, onChange, label = "Group", sx }) {
  const sections = sectionsByGroup(items, groups);
  if (!groups.length || sections.length < 2) return null;
  return (
    <Box sx={sx}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>{label}</Typography>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Chip label="All" size="small" onClick={() => onChange("")} color={!value ? "primary" : "default"} variant={!value ? "filled" : "outlined"} />
        {sections.map((s) => (
          <Chip
            key={s.key}
            label={s.title}
            size="small"
            onClick={() => onChange(s.key)}
            color={value === s.key ? "primary" : "default"}
            variant={value === s.key ? "filled" : "outlined"}
          />
        ))}
      </Box>
    </Box>
  );
}

export function GroupHeader({ title, count, first }) {
  if (!title) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: first ? 0 : 3, mb: 1.5, color: "primary.main" }}>
      <FolderOpen size={15} />
      <Typography sx={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</Typography>
      {count != null && <Typography variant="caption" color="text.secondary">· {count}</Typography>}
      <Box sx={{ flex: 1, height: "1px", bgcolor: "divider", ml: 0.5 }} />
    </Box>
  );
}
