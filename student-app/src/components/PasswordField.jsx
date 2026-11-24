import { useState } from "react";
import { TextField, InputAdornment, IconButton } from "@mui/material";
import { Eye, EyeOff } from "lucide-react";

// Every masked field gets the same reveal toggle. Typing a password blind on
// a phone keyboard, with no way to check what actually landed, is a routine
// source of "wrong password" support tickets that a single icon button
// avoids — this wraps TextField rather than replacing it, so every existing
// prop (label, value, onChange, helperText, fullWidth...) still works.
export default function PasswordField({ InputProps, ...props }) {
  const [show, setShow] = useState(false);

  return (
    <TextField
      {...props}
      type={show ? "text" : "password"}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              onClick={() => setShow((s) => !s)}
              edge="end"
              size="small"
              tabIndex={-1}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}
