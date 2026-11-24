import { Link2 } from "lucide-react";
import { useGetShortLinksForCouponQuery } from "../api/contentApi";
import { useTerms } from "../terms";

// Dropped under a coupon wherever ReferralLinkButton is — shows what its
// short links (if any exist yet) have actually done. redemptions here is a
// real per-link count (see getShortLinksForCoupon on the backend, which
// aggregates Purchase.viaShortLink), not a guessed conversion rate applied
// uniformly across every link a coupon has.
export default function CouponLinksList({ couponCode }) {
  const terms = useTerms();
  const { data } = useGetShortLinksForCouponQuery(couponCode);
  const links = data?.links || [];

  if (links.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 3, marginTop: 6 }}>
      {links.map((link) => {
        const rate = link.clicks > 0 ? Math.round((link.redemptions / link.clicks) * 100) : null;
        return (
          <div key={link._id} className="row-tight muted small" style={{ gap: 6, flexWrap: "wrap" }}>
            <Link2 size={11} />
            <span className="tnum" style={{ fontFamily: "monospace" }}>/r/{link.code}</span>
            <span>
              {link.batch?.name || `Unknown ${terms.batch}`}
              {link.target === "aiCredits" ? " (AI credits)" : ""}
            </span>
            <span className="tnum">{link.clicks} click{link.clicks === 1 ? "" : "s"}</span>
            <span className="tnum">{link.redemptions} redemption{link.redemptions === 1 ? "" : "s"}</span>
            {rate !== null && <span className="tnum">{rate}% conversion</span>}
          </div>
        );
      })}
    </div>
  );
}
