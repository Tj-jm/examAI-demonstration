import { Megaphone } from "lucide-react";

// A stock "generic announcement" photo would look identical on every
// imageless notice and read as filler, not intentional. A themed gradient
// with the notice-board icon costs nothing to keep in sync with whatever
// theme colors are active, and never looks like a broken image or an
// empty gap — which is the actual failure mode this exists to avoid.
export default function NoticeCoverFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, var(--accent) 0%, var(--surface) 140%)",
        opacity: 0.85,
      }}
    >
      <Megaphone size={28} color="#fff" strokeWidth={1.5} style={{ opacity: 0.9 }} />
    </div>
  );
}
