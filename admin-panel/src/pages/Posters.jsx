import { useEffect, useRef, useState } from "react";
import { Sparkles, Download, Copy, ImagePlus, X, Film, Upload, Image as ImageIcon } from "lucide-react";
import { useGetPosterOptionsQuery, useGetTopScorersQuery, useWritePosterMutation, usePosterBackgroundMutation, usePosterVoiceMutation } from "../api/posterApi";
import { useGetSettingsQuery } from "../api/contentApi";
import { ErrorNote, Field } from "../components/bits";
import { drawPoster, POSTER_SIZES, PALETTES } from "../utils/drawPoster";
import { POSTER_LAYOUTS, POSTER_LOOKS, POSTER_FONTS, defaultLayout } from "../utils/posterStyles";
import PromoVideo from "../components/PromoVideo";
import SearchSelect from "../components/SearchSelect";

const KINDS = [
  ["batch", "New course"],
  ["results", "Top scorers"],
  ["offer", "Admission offer"],
  ["greeting", "Festival greeting"],
  ["general", "General post"],
];
const FESTIVALS = [
  "Eid ul-Fitr", "Eid ul-Adha", "Ramadan", "Pohela Boishakh (Bangla New Year)", "Durga Puja", "International Mother Language Day (21 February)",
  "Independence Day (26 March)", "Victory Day (16 December)", "Buddha Purnima", "Christmas", "Happy New Year", "Teachers' Day",
];

const CONTACT_KEY = "examai.posterContact";
const readContact = () => {
  try { return localStorage.getItem(CONTACT_KEY) || ""; } catch { return ""; }
};

// Posts, posters and promo videos for Facebook and the like: AI writes the
// text from real facts (a course, an exam's top scorers, an offer) or for
// a festival greeting or a general post, the poster is drawn here and
// downloaded as a PNG (or played as a short video and downloaded), the
// caption is copied. Nothing is posted
// for you: Facebook only allows that for apps it has reviewed.
export default function Posters() {
  const { data: options } = useGetPosterOptionsQuery();
  const { data: settings } = useGetSettingsQuery();
  const [write, writeState] = useWritePosterMutation();
  const [makeBackground, bgState] = usePosterBackgroundMutation();
  const canvasRef = useRef(null);

  const [kind, setKind] = useState("batch");
  const [batch, setBatch] = useState("");
  const [exam, setExam] = useState("");
  const [count, setCount] = useState(5);
  const [offer, setOffer] = useState("");
  const [until, setUntil] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [festival, setFestival] = useState("");
  const [otherFestival, setOtherFestival] = useState("");
  const [language, setLanguage] = useState("en");
  const [text, setText] = useState({ headline: "", subline: "", points: [], cta: "", caption: "", imagePrompt: "", voiceover: "" });
  const [pictureStyle, setPictureStyle] = useState("soft");
  const [mode, setMode] = useState("poster");
  const [contact, setContact] = useState(readContact);
  const [size, setSize] = useState("square");
  const [palette, setPalette] = useState("navy");
  // Layout, hand-made look (its own colours and fonts) and font pair.
  const [layout, setLayout] = useState("classic");
  const [look, setLook] = useState("");
  const [font, setFont] = useState("clean");
  const [showPhoto, setShowPhoto] = useState(true);
  const style = { layout, look, font, photo: showPhoto };
  const [cut, setCut] = useState([]);
  const pickKind = (k) => { setKind(k); setLayout(defaultLayout(k)); };
  const [background, setBackground] = useState(null);
  const [showLogo, setShowLogo] = useState(true);
  const [note, setNote] = useState("");

  const { data: top } = useGetTopScorersQuery({ exam, count }, { skip: kind !== "results" || !exam });

  const occasion = festival === "other" ? otherFestival.trim() : festival;
  const poster = {
    kind,
    ...text,
    // A greeting is tagged with its festival; a general post has no tag.
    ...(kind === "greeting" ? { tag: occasion ? occasion.replace(/\s*\(.*\)$/, "").toUpperCase().slice(0, 28) : "" } : kind === "general" ? { tag: "" } : {}),
    scorers: kind === "results" ? top?.scorers || [] : [],
    examTitle: kind === "results" ? top?.exam?.title : "",
    cover: null,
    siteName: settings?.siteName || "",
    logo: showLogo ? settings?.logo || null : null,
    contact,
    background,
    // The ticket layout's big line, date and code.
    ...(kind === "offer" ? { offerText: offer.trim(), until: until ? `Until ${new Date(until).toLocaleDateString(language === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "long" })}` : "", couponCode: couponCode.trim() } : {}),
  };

  // Redraw on every change; the last draw wins.
  const posterKey = JSON.stringify({ poster, size, palette, pictureStyle, style });
  useEffect(() => {
    let live = true;
    const canvas = canvasRef.current;
    if (!canvas || mode !== "poster") return undefined;
    const k = JSON.parse(posterKey);
    drawPoster(canvas, k.poster, { size, palette, pictureStyle, style: k.style }).then(({ logoOk, cut: left }) => {
      if (!live) return;
      if (!logoOk) setNote("The logo couldn't be added (its storage doesn't allow it). The poster is drawn without it.");
      setCut(left);
    });
    return () => { live = false; };
  }, [posterKey, size, palette, pictureStyle, mode]);

  useEffect(() => {
    try { localStorage.setItem(CONTACT_KEY, contact); } catch { /* fine */ }
  }, [contact]);

  const set = (patch) => setText((t) => ({ ...t, ...patch }));

  const runWrite = async () => {
    try {
      const data = await write({ kind, batch, exam, count, offer, until, couponCode, prompt, language, festival: occasion }).unwrap();
      setText({ headline: data.headline || "", subline: data.subline || "", points: data.points || [], cta: data.cta || "", caption: data.caption || "", imagePrompt: data.imagePrompt || "", voiceover: data.voiceover || "" });
    } catch { /* shown below */ }
  };

  const runBackground = async () => {
    try {
      const data = await makeBackground({ kind, festival: occasion, prompt: text.imagePrompt, shape: size === "square" ? "square" : "tall" }).unwrap();
      setBackground(data.dataUrl);
    } catch { /* shown below */ }
  };

  // A picture of their own instead: scaled down to at most 2000 px so the
  // poster and the video stay light.
  const uploadBackground = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      setBackground(c.toDataURL("image/jpeg", 0.9));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return setNote("Couldn't make the picture in this browser.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(text.headline || "poster").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(text.caption);
      setNote("Caption copied.");
    } catch {
      setNote("Couldn't copy. Select the caption and copy it by hand.");
    }
  };

  const ready = kind === "results" ? Boolean(exam)
    : kind === "offer" ? Boolean(batch || offer.trim())
    : kind === "greeting" ? Boolean(occasion)
    : kind === "general" ? Boolean(prompt.trim())
    : Boolean(batch);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Posters</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            A Facebook post, a poster and a short promo video for a new course, an exam's top scorers, an admission offer, a festival greeting or anything else. AI writes it from your real data; download the poster or video and copy the caption to post.
          </p>
        </div>
      </div>

      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {KINDS.map(([k, label]) => (
          <button key={k} className={`pill pill-btn${kind === k ? " pill-on" : ""}`} onClick={() => pickKind(k)}>{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
        <div className="stack">
          <div className="card stack">
            {kind === "results" ? (
              <>
                <Field label="Exam">
                  <SearchSelect className="select" value={exam} onChange={(e) => setExam(e.target.value)}>
                    <option value="">Pick an exam</option>
                    {(options?.exams || []).map((e) => (
                      <option key={e._id} value={e._id}>{e.title}{e.batchName ? ` · ${e.batchName}` : ""}</option>
                    ))}
                  </SearchSelect>
                </Field>
                <Field label="How many scorers">
                  <input className="input tnum" type="number" min="1" max="10" style={{ width: 100 }} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
                </Field>
                {exam && top && !top.scorers.length && <p className="hint" style={{ margin: 0 }}>No graded results for this exam yet.</p>}
              </>
            ) : kind === "greeting" ? (
              <>
                <Field label="Festival or day">
                  <select className="select" value={festival} onChange={(e) => setFestival(e.target.value)}>
                    <option value="">Pick one</option>
                    {FESTIVALS.map((f) => <option key={f} value={f}>{f}</option>)}
                    <option value="other">Other…</option>
                  </select>
                </Field>
                {festival === "other" && (
                  <Field label="Which one">
                    <input className="input" value={otherFestival} maxLength={80} onChange={(e) => setOtherFestival(e.target.value)} placeholder="Shab-e-Barat, our 10th anniversary…" />
                  </Field>
                )}
              </>
            ) : (
              <Field label={kind === "general" ? "Course (optional)" : "Course"}>
                <SearchSelect className="select" value={batch} onChange={(e) => setBatch(e.target.value)}>
                  <option value="">{kind === "offer" ? "Any (describe the offer below)" : kind === "general" ? "None" : "Pick a course"}</option>
                  {(options?.batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </SearchSelect>
              </Field>
            )}
            {kind === "offer" && (
              <>
                <Field label="The offer">
                  <input className="input" value={offer} maxLength={300} onChange={(e) => setOffer(e.target.value)} placeholder="20% off the HSC 27 batch" />
                </Field>
                <div className="row-tight" style={{ flexWrap: "wrap", gap: 12 }}>
                  <Field label="Ends (optional)">
                    <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                  </Field>
                  <Field label="Code (optional)">
                    <input className="input" style={{ width: 160, textTransform: "uppercase" }} value={couponCode} maxLength={40} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </>
            )}
            <Field label={kind === "general" ? "What the post is about" : "Anything to add (optional)"}>
              {kind === "general"
                ? <textarea className="textarea" rows={3} value={prompt} maxLength={800} onChange={(e) => setPrompt(e.target.value)} placeholder="Tips for the last month before HSC. Our new library room is open. Results day is next Monday…" />
                : <input className="input" value={prompt} maxLength={800} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === "greeting" ? "From all teachers of our centre." : "Classes start 1 November. Mention the free trial."} />}
            </Field>
            <div className="row-tight" style={{ flexWrap: "wrap" }}>
              <select className="select" style={{ width: "auto" }} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="bn">বাংলা</option>
              </select>
              <button className="btn btn-primary" disabled={!ready || writeState.isLoading} onClick={runWrite}>
                <Sparkles size={15} /> {writeState.isLoading ? "Writing…" : "Write with AI"}
              </button>
            </div>
            <ErrorNote error={writeState.error} />
          </div>

          <div className="card stack">
            <span className="label">Poster text</span>
            <Field label="Headline">
              <input className="input" value={text.headline} maxLength={80} onChange={(e) => set({ headline: e.target.value })} />
            </Field>
            <Field label="Line under it">
              <input className="input" value={text.subline} maxLength={160} onChange={(e) => set({ subline: e.target.value })} />
            </Field>
            {kind !== "results" && (
              <Field label="Points" hint="One per line, up to 4.">
                <textarea className="textarea" rows={4} value={text.points.join("\n")}
                  onChange={(e) => set({ points: e.target.value.split("\n").slice(0, 4) })} />
              </Field>
            )}
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 12 }}>
              <Field label="Button">
                <input className="input" value={text.cta} maxLength={40} onChange={(e) => set({ cta: e.target.value })} placeholder="Enrol now" />
              </Field>
              <Field label="Contact (kept for next time)">
                <input className="input" value={contact} maxLength={80} onChange={(e) => setContact(e.target.value)} placeholder="01XXXXXXXXX · yoursite.com" />
              </Field>
            </div>
            <Field label="Facebook caption">
              <textarea className="textarea" rows={6} value={text.caption} maxLength={1500} onChange={(e) => set({ caption: e.target.value })} />
            </Field>
            <div className="row-tight">
              <button className="btn" disabled={!text.caption} onClick={copyCaption}><Copy size={15} /> Copy caption</button>
            </div>
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
            <select className="select" style={{ width: "auto" }} value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.entries(POSTER_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {!look && Object.entries(PALETTES).map(([k, v]) => (
              <button key={k} title={k} aria-label={`${k} colours`} onClick={() => setPalette(k)}
                style={{ width: 28, height: 28, borderRadius: 14, cursor: "pointer", background: `linear-gradient(135deg, ${v.bg}, ${v.bg2})`,
                  border: palette === k ? `3px solid ${v.accent}` : "1px solid var(--border, #ccc)" }} />
            ))}
          </div>
          <div className="row-tight small" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="muted" style={{ minWidth: 48 }}>Layout</span>
            {POSTER_LAYOUTS.map(([v, l]) => (
              <button key={v} className={`pill pill-btn${layout === v ? " pill-on" : ""}`} onClick={() => setLayout(v)}>{l}</button>
            ))}
          </div>
          {layout === "podium" && kind !== "results" && <span className="hint small">Podium is for top scorers; other posts show as Centered.</span>}
          <div className="row-tight small" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="muted" style={{ minWidth: 48 }}>Look</span>
            <button className={`pill pill-btn${!look ? " pill-on" : ""}`} onClick={() => { setLook(""); if (!font) setFont("clean"); }}>Your colours</button>
            {Object.entries(POSTER_LOOKS).map(([v, L]) => (
              <button key={v} className={`pill pill-btn${look === v ? " pill-on" : ""}`} onClick={() => { setLook(v); setFont(""); }}>{L.label}</button>
            ))}
          </div>
          {look && (
            <div className="row-tight small" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="hint">This look has its own colours.</span>
              {background && !["split", "card", "magazine"].includes(layout) && (
                layout === "podium"
                  ? <span className="hint">Podium has no room for the picture.</span>
                  : <label className="row-tight" style={{ gap: 6 }}><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /> Show the picture as a framed photo</label>
              )}
            </div>
          )}
          <div className="row-tight small" style={{ gap: 6, flexWrap: "wrap" }}>
            <span className="muted" style={{ minWidth: 48 }}>Font</span>
            {look && <button className={`pill pill-btn${!font ? " pill-on" : ""}`} onClick={() => setFont("")}>The look's own</button>}
            {Object.entries(POSTER_FONTS).map(([v, F]) => (
              <button key={v} className={`pill pill-btn${font === v ? " pill-on" : ""}`} style={{ fontFamily: F.head, fontWeight: F.headW }} onClick={() => setFont(v)}>{F.label}</button>
            ))}
          </div>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
            <button className="btn btn-sm" disabled={bgState.isLoading} onClick={runBackground}>
              <ImagePlus size={14} /> {bgState.isLoading ? "Making picture…" : background ? "New AI picture" : "AI picture"}
            </button>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              <Upload size={14} /> Upload picture
              <input type="file" accept="image/*" hidden onChange={(e) => { uploadBackground(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {background && <button className="btn btn-sm" onClick={() => setBackground(null)}><X size={14} /> Remove picture</button>}
            {settings?.logo && (
              <label className="row-tight small" style={{ gap: 6 }}>
                <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} /> Logo
              </label>
            )}
          </div>
          <Field label="Picture (AI makes it from this)" hint={kind === "general" ? "Write with AI suggests one; change it to anything, then press AI picture." : "Leave empty for a picture that suits the post."}>
            <input className="input" value={text.imagePrompt} maxLength={400} onChange={(e) => set({ imagePrompt: e.target.value })}
              placeholder={kind === "greeting" ? "A family sharing sweets under lanterns at dusk" : "Students reading together in a sunny library"} />
          </Field>
          {background && (
            <div className="row-tight small" style={{ gap: 8 }}>
              <span className="muted">Picture:</span>
              {[["soft", "Behind the text"], ["strong", "Show it more"]].map(([v, l]) => (
                <button key={v} className={`pill pill-btn${pictureStyle === v ? " pill-on" : ""}`} onClick={() => setPictureStyle(v)}>{l}</button>
              ))}
            </div>
          )}
          <ErrorNote error={bgState.error} />
          <div className="row-tight small" style={{ gap: 8 }}>
            <button className={`pill pill-btn${mode === "poster" ? " pill-on" : ""}`} onClick={() => setMode("poster")}><ImageIcon size={13} /> Poster</button>
            <button className={`pill pill-btn${mode === "video" ? " pill-on" : ""}`} onClick={() => setMode("video")}><Film size={13} /> Promo video</button>
          </div>
          {mode === "poster" ? (
            <>
              <canvas ref={canvasRef} style={{ width: "100%", height: "auto", borderRadius: 8, border: "1px solid var(--border, #ddd)" }} />
              {cut.length > 0 && text.headline && (
                <span className="hint small">Left out to fit this size: {cut.join(", ")}.{size !== "story" ? " Portrait or Story has room for it." : " Shorten the text to fit it."}</span>
              )}
              <div className="row-tight">
                <button className="btn btn-primary" disabled={!text.headline} onClick={download}><Download size={15} /> Download poster</button>
              </div>
            </>
          ) : (
            <PromoVideo poster={poster} size={size} palette={palette} pictureStyle={pictureStyle} style={style} language={language}
              voiceover={text.voiceover} onVoiceover={(v) => set({ voiceover: v })} voiceReady={Boolean(options?.voiceReady)} />
          )}
          {note && <p className="hint" style={{ margin: 0 }}>{note}</p>}
        </div>
      </div>
    </div>
  );
}
