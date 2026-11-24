import { TextField, InputAdornment, Select, MenuItem, Typography } from "@mui/material";
import { useState } from "react";
import { useBranding } from "../BrandingContext";
import { MenuSearch, matches } from "./PickField";

// A phone number with its country beside it. The countries are the ones the
// institution accepts (admin → Settings → Student app → Sign-up), the
// default first; with only one there's nothing to pick, just its code.
export default function PhoneField({ country, onCountry, value, onChange, ...props }) {
  const { phoneCountries: countries } = useBranding();
  const current = countries.find((c) => c.code === country) || countries[0];
  // A long list gets a search box at the top of its menu.
  const [query, setQuery] = useState("");
  const searchable = countries.length > 8;
  const shown = searchable ? countries.filter((c) => c.code === current?.code || matches(`${c.name} ${c.dial} +${c.dial}`, query)) : countries;
  const prefix = countries.length > 1 ? (
    <Select
      variant="standard"
      disableUnderline
      value={current?.code || ""}
      onChange={(e) => onCountry(e.target.value)}
      renderValue={(code) => `+${countries.find((c) => c.code === code)?.dial || ""}`}
      MenuProps={{ PaperProps: { sx: { maxHeight: 360 } }, autoFocus: !searchable }}
      onClose={() => setQuery("")}
      sx={{ minWidth: 64, fontWeight: 600, "& .MuiSelect-select": { py: 0 } }}
      inputProps={{ "aria-label": "Country" }}
    >
      {searchable && <MenuSearch query={query} onQuery={setQuery} placeholder="Search countries" />}
      {shown.map((c) => (
        <MenuItem key={c.code} value={c.code}>
          {c.name}
          <Typography component="span" color="text.secondary" sx={{ ml: "auto", pl: 2 }}>+{c.dial}</Typography>
        </MenuItem>
      ))}
    </Select>
  ) : (
    <Typography sx={{ fontWeight: 600 }}>+{current?.dial}</Typography>
  );
  return (
    <TextField
      label="Phone number"
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      value={value}
      onChange={onChange}
      InputProps={{ startAdornment: <InputAdornment position="start">{prefix}</InputAdornment> }}
      {...props}
    />
  );
}
