import { Megaphone } from "lucide-react";
import { useTheme, alpha } from "@mui/material/styles";

// A stock "generic announcement" photo would look identical on every
// imageless notice, which reads as filler rather than something someone
// actually wrote. A gradient built from the active theme's own colors —
// so it never clashes with whichever of the six themes is selected — with
// the notice-board icon costs nothing to keep in sync, and never looks like
// a broken image or an empty gap, which is the actual failure this exists
// to prevent.
export default function NoticeCoverFallback({ iconSize = 30 }) {
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
      <Megaphone size={iconSize} color="#fff" strokeWidth={1.5} style={{ opacity: 0.9 }} />
    </div>
  );
}
