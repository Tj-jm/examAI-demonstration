import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { WifiOff, Wifi } from "lucide-react";
import { isNative } from "./session";

// A strip under the status bar while the phone has no connection, and a
// short "Back online" when it returns (the pages refetch on their own then).
// Pages stay usable with what they already loaded; an exam keeps its
// answers and sends them once the connection is back.
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [back, setBack] = useState(false);

  useEffect(() => {
    if (!isNative) return undefined;
    let timer;
    const up = () => { setOnline(true); setBack(true); clearTimeout(timer); timer = setTimeout(() => setBack(false), 2500); };
    const down = () => { setOnline(false); setBack(false); };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearTimeout(timer); };
  }, []);

  if (!isNative || (online && !back)) return null;
  return (
    <Box
      role="status"
      sx={{
        position: "fixed", left: 0, right: 0, top: "env(safe-area-inset-top, 0px)", zIndex: 1999,
        px: 2, py: 0.75, display: "flex", alignItems: "center", justifyContent: "center", gap: 1,
        fontSize: 13, fontWeight: 500,
        bgcolor: online ? "success.main" : "grey.800", color: "#fff",
      }}
    >
      {online ? <Wifi size={15} /> : <WifiOff size={15} />}
      {online ? "Back online" : "No connection. Showing what was already loaded."}
    </Box>
  );
}
