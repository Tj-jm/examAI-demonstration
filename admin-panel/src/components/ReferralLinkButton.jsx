import { useState } from "react";
import { Link2, Check, Scissors } from "lucide-react";
import { useCreateShortLinkMutation } from "../api/contentApi";
import { useTerms } from "../terms";
import SearchSelect from "./SearchSelect";

// Dropped next to a coupon wherever one is shown — the representative's own
// performance page, and the admin coupon list. A referral link is just this
// app's existing plan-picker page (student-app's /purchases/:batchId) with
// ?ref=<code> attached; PlanPicker.jsx reads that param once on mount and
// seeds the coupon field with it, so everything past this point — validation,
// the animated discount preview, redemption tracking, representative
// attribution — is the exact same pipeline a hand-typed code goes through.
// The short link (see shortLinkModel.js) is just a stored version of this
// same URL behind a 6-character code; nothing new to keep in sync either
// way, both only ever have to get the destination right.
export default function ReferralLinkButton({ coupon, allBatches }) {
  const terms = useTerms();
  const scoped = coupon.batches?.length > 0;
  const onBatches = (coupon.products || []).some((p) => p === "subscriptions" || p === "aiCredits");
  const options = onBatches ? (scoped ? coupon.batches : (allBatches || [])) : [];

  const [batchId, setBatchId] = useState(scoped && coupon.batches.length === 1 ? coupon.batches[0]._id : "");
  const [copied, setCopied] = useState(false);
  const [createShortLink, { isLoading: shortening }] = useCreateShortLinkMutation();

  // An AI-credits-only coupon has to land on the AI credits page — the
  // subscription page would just reject it as invalid the moment it's
  // previewed, since coupon.isValid() now checks what a coupon actually
  // covers (see couponModel.js's products field). Anything that also
  // covers subscriptions (the default) still goes to the subscribe page,
  // since that's what "referral link" means for the common case. Computed
  // once here so the long link and the short link can never disagree on
  // where the same coupon should send someone.
  const aiCreditsOnly = coupon.products?.length === 1 && coupon.products[0] === "aiCredits";
  const target = aiCreditsOnly ? "aiCredits" : "subscribe";
  const path = aiCreditsOnly ? `/batches/${batchId}/ai-credits` : `/purchases/${batchId}`;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (permissions, non-secure context) —
      // falling back to a prompt at least still gets the link in front of
      // the person, rather than the button just silently doing nothing.
      window.prompt("Copy this link:", text);
    }
  };

  // window.location.origin, not a hardcoded domain — correct in
  // production, where the admin panel and student app are served from the
  // same origin. In local dev, where they're two separate Vite servers on
  // different ports, this would build a link pointing at the admin
  // panel's own port instead of the student app's — a real caveat, not
  // something to silently paper over.
  const copyLong = () => {
    if (!batchId) return;
    copyText(`${window.location.origin}${path}?ref=${encodeURIComponent(coupon.code)}`);
  };

  const copyShort = async () => {
    if (!batchId) return;
    try {
      const result = await createShortLink({ batchId, couponCode: coupon.code, target }).unwrap();
      copyText(result.url);
    } catch {
      // The long link still works as a fallback if shortening fails for
      // any reason (a server hiccup, a momentary network issue) — better
      // than leaving the person with nothing to share at all.
      copyLong();
    }
  };

  if (options.length === 0) {
    return <span className="hint">Nothing this coupon works on to link to.</span>;
  }

  return (
    <div className="row-tight" style={{ flexWrap: "wrap" }}>
      <SearchSelect
        className="select"
        value={batchId}
        onChange={(e) => setBatchId(e.target.value)}
        style={{ maxWidth: 200 }}
        searchFrom={4}
      >
        <option value="">{`Pick a ${terms.batch}`}</option>
        {options.length > 0 && <optgroup label={terms.Batches || "Batches"}>{options.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}</optgroup>}
      </SearchSelect>
      <button type="button" className="btn btn-sm btn-quiet" disabled={!batchId || shortening} onClick={copyShort}>
        {copied ? <><Check size={13} /> Copied</> : <><Scissors size={13} /> {shortening ? "Shortening…" : "Copy short link"}</>}
      </button>
      <button type="button" className="icon-btn" title="Copy the full, unshortened link instead" disabled={!batchId} onClick={copyLong}>
        <Link2 size={13} />
      </button>
    </div>
  );
}
