import { useState } from "react";
import { Autocomplete, TextField, MenuItem, ListSubheader, InputAdornment } from "@mui/material";
import { Search } from "lucide-react";

// A pick-one field that stays a plain select for a short list and becomes
// a searchable one (type to filter) once the list is longer than
// `searchFrom`. options: [{ value, label }]. emptyLabel: the "none" choice
// (value ""), when there is one. onChange gets the value.
export default function PickField({ label, value, onChange, options, emptyLabel, searchFrom = 8, size, sx, fullWidth, placeholder }) {
  const all = emptyLabel != null ? [{ value: "", label: emptyLabel }, ...options] : options;
  if (options.length <= searchFrom) {
    return (
      <TextField select label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} size={size} sx={sx} fullWidth={fullWidth}
        SelectProps={{ displayEmpty: emptyLabel != null && !label }}>
        {all.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    );
  }
  const chosen = all.find((o) => o.value === (value ?? "")) || null;
  return (
    <Autocomplete
      options={all}
      value={chosen}
      onChange={(e, o) => onChange(o ? o.value : "")}
      getOptionLabel={(o) => o?.label || ""}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      disableClearable={emptyLabel == null}
      autoHighlight
      size={size}
      sx={sx}
      fullWidth={fullWidth}
      noOptionsText="Nothing matches"
      renderOption={(props, o) => <li {...props} key={o.value}>{o.label}</li>}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder || "Type to search"} />}
    />
  );
}

// A search box for the top of a MUI Select's menu. MUI hands every child
// of a Select a click handler that picks it; this one drops that, so a tap
// on the box never picks anything. Keys stay in the box, except the arrows,
// which move down into the list.
export function MenuSearch({ query, onQuery, placeholder = "Search" }) {
  return (
    <ListSubheader sx={{ pt: 1, pb: 1, lineHeight: "normal" }}>
      <TextField
        size="small"
        autoFocus
        fullWidth
        value={query}
        placeholder={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => { if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(e.key)) e.stopPropagation(); }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
      />
    </ListSubheader>
  );
}

// The words of a query, all of which a label must contain.
export const matches = (label, query) => {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const l = String(label || "").toLocaleLowerCase();
  return words.every((w) => l.includes(w));
};

export const useMenuQuery = () => useState("");
