import { GraduationCap } from "lucide-react";
import { useTheme, alpha } from "@mui/material/styles";

// Same reasoning as NoticeCoverFallback: a stock photo would look identical
// on every program that skipped uploading a cover, which reads as filler.
// A gradient built from the active theme's own primary color, so it never
// clashes with whichever of the six themes is selected, with a generic
// "program" icon — never a broken image, never an empty gap.
export default function ProgramCoverFallback() {
  const theme = useTheme();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${alpha(theme.palette.primary.main, 0.55)} 140%)`,
      }}
    >
      <GraduationCap size={32} color="#fff" strokeWidth={1.5} style={{ opacity: 0.9 }} />
    </div>
  );
}
