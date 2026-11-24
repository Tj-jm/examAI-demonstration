import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";

// Tells the server how this connection is doing: a "q" attribute on our own
// participant (excellent/good/poor/lost), read by the admin Performance
// page's live monitor (backend utils/liveMonitor.js). Set only on change.
export function useReportQuality() {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!localParticipant) return undefined;
    let last = null;
    const report = (quality) => {
      const q = String(quality || "").toLowerCase();
      if (!["excellent", "good", "poor", "lost"].includes(q) || q === last) return;
      last = q;
      localParticipant.setAttributes({ q }).catch(() => {});
    };
    report(localParticipant.connectionQuality);
    localParticipant.on("connectionQualityChanged", report);
    return () => { localParticipant.off("connectionQualityChanged", report); };
  }, [localParticipant]);
}
