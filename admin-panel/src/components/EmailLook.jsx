import { useEffect, useState } from "react";
import { Mail, Send, Sun, Moon } from "lucide-react";
import { usePreviewEmailMutation, useTestEmailMutation } from "../api/contentApi";
import { ErrorNote } from "./bits";

// Settings → Brand → Emails: how every email looks (backend
// utils/emailLayout.js), with the colours chosen here before saving, and a
// test sent to my own address (with the saved settings).
const KINDS = [["reminder", "Reminder"], ["code", "Sign-in code"], ["notice", "Notice"]];

export default function EmailLook({ studentUi = {}, siteName }) {
  const [kind, setKind] = useState("reminder");
  const [dark, setDark] = useState(false);
  const [preview, { data }] = usePreviewEmailMutation();
  const [test, sent] = useTestEmailMutation();
  useEffect(() => {
    const t = setTimeout(() => preview({ kind, siteName, theme: studentUi.theme, customTheme: studentUi.customTheme }), 250);
    return () => clearTimeout(t);
  }, [kind, siteName, studentUi.theme, studentUi.customTheme, preview]);
  return (
    <div className="field">
      <span className="label row-tight" style={{ gap: 6 }}><Mail size={14} /> Emails</span>
      <span className="hint" style={{ margin: 0 }}>Every email uses your logo, name and the student app's theme colour. Address and phone in the footer come from receipt details.</span>
      <div className="row-tight" style={{ gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {KINDS.map(([v, l]) => <button key={v} className={`pill pill-btn${kind === v ? " pill-on" : ""}`} onClick={() => setKind(v)}>{l}</button>)}
        <button className="btn btn-quiet btn-sm row-tight" style={{ gap: 5 }} onClick={() => setDark((d) => !d)}>{dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? "Light" : "Dark"} mail app</button>
        <button className="btn btn-sm row-tight" style={{ gap: 5, marginLeft: "auto" }} disabled={sent.isLoading} onClick={() => test({ kind })}><Send size={14} /> {sent.isLoading ? "Sending…" : "Send me a test"}</button>
      </div>
      {sent.data?.to && <span className="hint" style={{ margin: 0 }}>Sent to {sent.data.to}. The test uses saved settings.</span>}
      {sent.error && <ErrorNote error={sent.error} />}
      <div style={{ width: 380, maxWidth: "100%", height: 560, border: "8px solid #16181d", borderRadius: 28, overflow: "hidden", background: dark ? "#17181c" : "#eef0f5" }}>
        {data?.html && <iframe title="Email preview" srcDoc={data.html} sandbox="" style={{ width: "100%", height: "100%", border: 0, colorScheme: dark ? "dark" : "light" }} />}
      </div>
    </div>
  );
}
