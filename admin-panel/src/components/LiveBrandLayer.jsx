import { useParticipants, useLocalParticipant } from "@livekit/components-react";

// The classroom's own look over the video (Settings → Student app → Live
// classroom): the logo as a watermark, each student's name faint across the
// picture (a leaked recording shows who made it), and a waiting screen
// while no host is in the room. Pointer-transparent: it never blocks the
// video or the controls. Plain styles so both apps can share it.

const CORNER = {
  tl: { top: 14, left: 14 },
  tr: { top: 14, right: 14 },
  bl: { bottom: 86, left: 14 },
  br: { bottom: 86, right: 14 },
};

const roleOf = (p) => {
  try {
    return JSON.parse(p.metadata || "{}").role || "";
  } catch {
    return "";
  }
};

export default function LiveBrandLayer({ branding = {}, nameMark = false, showWaiting = true }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const viewerName = nameMark ? localParticipant?.name : null;
  const hostHere = participants.some((p) => roleOf(p) === "host");
  const logo = branding.logo;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {branding.watermark && logo && (
        <img
          src={logo}
          alt=""
          style={{ position: "absolute", ...CORNER[branding.watermarkPosition || "br"], height: 44, opacity: branding.watermarkOpacity ?? 0.35 }}
        />
      )}
      {branding.nameWatermark && viewerName && (
        <div style={{ position: "absolute", inset: "-20%", display: "flex", flexWrap: "wrap", alignContent: "space-around", justifyContent: "space-around", transform: "rotate(-24deg)", opacity: 0.09 }}>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} style={{ color: "#fff", fontSize: 22, fontWeight: 700, padding: "40px 60px", whiteSpace: "nowrap" }}>{viewerName}</span>
          ))}
        </div>
      )}
      {showWaiting && !hostHere && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 72, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "rgba(10, 12, 16, 0.92)", color: "#f1f3f5", textAlign: "center", padding: 24 }}>
          {branding.waitingImage ? (
            <img src={branding.waitingImage} alt="" style={{ maxWidth: "min(560px, 90%)", maxHeight: "50%", borderRadius: 12 }} />
          ) : logo ? (
            <img src={logo} alt="" style={{ height: 64 }} />
          ) : null}
          <div style={{ fontSize: 20, fontWeight: 600 }}>{branding.waitingMessage || "The host will be with you shortly."}</div>
          <div style={{ fontSize: 14, opacity: 0.7 }}>Stay here — the class continues as soon as the host is back.</div>
        </div>
      )}
    </div>
  );
}

// The promo line under the room's header, with its link.
export function PromoBar({ branding = {} }) {
  if (!branding.promoText) return null;
  const accent = branding.accentColor || "#2fa58e";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "6px 14px", fontSize: 14, background: `${accent}26`, borderBottom: `1px solid ${accent}55`, flexWrap: "wrap" }}>
      <span>{branding.promoText}</span>
      {branding.promoUrl && (
        <a href={branding.promoUrl} target="_blank" rel="noreferrer" style={{ color: "#fff", background: accent, padding: "3px 12px", borderRadius: 999, fontWeight: 600, textDecoration: "none", fontSize: 13 }}>
          {branding.promoLabel || "Learn more"}
        </a>
      )}
    </div>
  );
}
