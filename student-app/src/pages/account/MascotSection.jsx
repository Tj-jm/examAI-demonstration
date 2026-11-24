import { useState } from "react";
import { Box, Typography, Paper, Switch, ButtonBase } from "@mui/material";
import { useBranding } from "../../BrandingContext";
import { MascotFigure, mascotHidden, setMascotHidden, MASCOT_HUES, mascotHue, setMascotHue } from "../../components/Mascot";

// The site mascot on or off, and its colour, on this device.
export default function MascotSection() {
  const { mascot } = useBranding();
  const [on, setOn] = useState(() => !mascotHidden());
  const [hue, setHue] = useState(mascotHue);
  if (!mascot?.character) return null;
  return (
    <Box>
      <Typography sx={{ fontWeight: 500, mb: 1 }}>{mascot.name || "Mascot"}</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <MascotFigure character={mascot.character} move={on ? "wave" : "sleep"} width={44} hue={hue} />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            Peeks in now and then and cheers your right answers. On this device.
          </Typography>
          <Switch
            checked={on}
            onChange={(e) => { setOn(e.target.checked); setMascotHidden(!e.target.checked); }}
            inputProps={{ "aria-label": "Show the mascot" }}
          />
        </Box>
        {on && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, mb: 1 }}>Colour</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {MASCOT_HUES.map((h) => (
                <ButtonBase
                  key={h}
                  aria-label={h ? `Colour ${MASCOT_HUES.indexOf(h)}` : "Original colour"}
                  aria-pressed={hue === h}
                  onClick={() => { setHue(h); setMascotHue(h); }}
                  sx={{
                    p: 0.5, borderRadius: 2, border: 2,
                    borderColor: hue === h ? "primary.main" : "transparent",
                    bgcolor: hue === h ? "action.selected" : "transparent",
                  }}
                >
                  <MascotFigure character={mascot.character} move="idle" width={34} hue={h} />
                </ButtonBase>
              ))}
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
