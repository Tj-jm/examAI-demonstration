import { Box, Typography, Button, Alert, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer, ShieldCheck, ShieldX } from "lucide-react";
import { useVerifyCertificateQuery } from "../../api/contentApi";
import { isNative } from "../../native/session";

const PRINT_CSS = `
@page { size: A4 landscape; margin: 0; }
@media print {
  body * { visibility: hidden; }
  .cert, .cert * { visibility: visible; }
  .cert { position: absolute; inset: 0; margin: 0 !important; width: 100% !important; max-width: none !important; box-shadow: none !important; }
  .no-print { display: none !important; }
}`;

// The certificate itself, drawn in plain CSS so it prints the same anywhere.
function CertificateArt({ c }) {
  const classic = c.style !== "modern";
  const date = new Date(c.issuedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  // From the server: the student site's public address. The page's own
  // origin is wrong inside the mobile app (https://localhost).
  const verifyUrl = c.verifyUrl && /^https?:\/\//.test(c.verifyUrl) ? c.verifyUrl : `${window.location.origin}/verify/${c.serial}`;
  return (
    <Box
      className="cert"
      sx={{
        position: "relative", bgcolor: "#fffdf7", color: "#1d1d1f", aspectRatio: "1.414 / 1", width: "100%", maxWidth: 960, mx: "auto",
        boxShadow: 3, overflow: "hidden", fontFamily: classic ? "Georgia, 'Times New Roman', serif" : "inherit", "& .MuiTypography-root": { fontFamily: "inherit" },
        ...(classic ? { border: "10px double #b08d3c", p: { xs: 2, sm: 5 } } : { borderLeft: "14px solid", borderColor: "primary.main", p: { xs: 2, sm: 6 } }),
        display: "flex", flexDirection: "column", alignItems: classic ? "center" : "flex-start", textAlign: classic ? "center" : "left",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: { xs: 1, sm: 2 } }}>
        {c.brand.logo && <img src={c.brand.logo} alt="" style={{ height: 40 }} />}
        <Typography sx={{ fontWeight: 700, letterSpacing: ".04em", fontSize: { xs: 13, sm: 18 } }}>{c.brand.name}</Typography>
      </Box>
      <Typography sx={{ fontSize: { xs: 20, sm: 40 }, fontWeight: 700, color: classic ? "#7a5c12" : "primary.main", lineHeight: 1.15 }}>{c.title}</Typography>
      <Typography sx={{ mt: { xs: 1, sm: 3 }, fontSize: { xs: 11, sm: 15 }, color: "#555" }}>Presented to</Typography>
      <Typography sx={{ fontSize: { xs: 22, sm: 44 }, fontWeight: 600, fontStyle: classic ? "italic" : "normal", borderBottom: "1px solid #bbb", px: 2, mt: 0.5 }}>{c.recipientName}</Typography>
      <Typography sx={{ mt: { xs: 1, sm: 3 }, maxWidth: 640, fontSize: { xs: 11, sm: 16 }, lineHeight: 1.5 }}>{c.body}</Typography>
      {c.grade && <Typography sx={{ mt: 1, fontSize: { xs: 11, sm: 15 } }}>Grade: <strong>{c.grade}</strong></Typography>}

      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: "flex", width: "100%", justifyContent: classic ? "space-around" : "flex-start", gap: { xs: 2, sm: 6 }, flexWrap: "wrap", mt: 2 }}>
        {(c.signatures.length ? c.signatures : [{ name: "", role: "" }]).map((s, i) => (
          <Box key={i} sx={{ minWidth: { xs: 90, sm: 180 }, textAlign: "center" }}>
            <Box sx={{ height: { xs: 30, sm: 56 }, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              {s.image && <Box component="img" src={s.image} alt="" sx={{ maxHeight: "100%", maxWidth: { xs: 110, sm: 200 } }} />}
            </Box>
            <Box sx={{ borderTop: "1px solid #333", pt: 0.5, fontSize: { xs: 10, sm: 14 }, fontWeight: 600 }}>{s.name || " "}</Box>
            <Box sx={{ fontSize: { xs: 9, sm: 12 }, color: "#555" }}>{s.role}</Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%", mt: { xs: 1, sm: 2 }, fontSize: { xs: 8, sm: 11 }, color: "#666", fontFamily: "ui-monospace, monospace" }}>
        <span>{date}</span>
        <span>No. {c.serial} · {verifyUrl}</span>
      </Box>
      {!c.valid && (
        <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <Typography sx={{ fontSize: { xs: 40, sm: 96 }, fontWeight: 800, color: "rgba(200,0,0,.25)", transform: "rotate(-20deg)", fontFamily: "inherit" }}>REVOKED</Typography>
        </Box>
      )}
    </Box>
  );
}

// /verify/<number>: open to anyone, signed in or not. Shows the certificate
// and whether it still stands, and prints it.
export default function VerifyCertificate() {
  const { serial } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useVerifyCertificateQuery(serial);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, minHeight: "100vh", bgcolor: "background.default" }}>
      <style>{PRINT_CSS}</style>
      <Box className="no-print" sx={{ maxWidth: 960, mx: "auto", mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
        <Button size="small" startIcon={<ArrowLeft size={16} />} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>Back</Button>
        <Box sx={{ flex: 1 }} />
        {data && !isNative && <Button variant="outlined" size="small" startIcon={<Printer size={16} />} onClick={() => window.print()}>Print or save as PDF</Button>}
      </Box>
      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}><CircularProgress /></Box>
      ) : error || !data ? (
        <Alert severity="error" icon={<ShieldX size={20} />} sx={{ maxWidth: 640, mx: "auto" }}>
          No certificate has the number <strong>{serial}</strong>. Check it was typed exactly as printed.
        </Alert>
      ) : (
        <>
          <Alert className="no-print" severity={data.valid ? "success" : "error"} icon={data.valid ? <ShieldCheck size={20} /> : <ShieldX size={20} />} sx={{ maxWidth: 960, mx: "auto", mb: 2 }}>
            {data.valid
              ? <>Genuine: issued by {data.brand.name} to <strong>{data.recipientName}</strong>{data.batchName ? ` for ${data.batchName}` : ""}.</>
              : <>This certificate was revoked on {new Date(data.revokedAt).toLocaleDateString()} and is no longer valid.</>}
          </Alert>
          <CertificateArt c={data} />
          <Typography className="no-print" variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 2 }}>
            Certificate number {data.serial}
          </Typography>
        </>
      )}
    </Box>
  );
}
