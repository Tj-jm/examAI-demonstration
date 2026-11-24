import { useLocation, useNavigate } from "react-router-dom";
import { Construction } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useTerms } from "../BrandingContext";

// Only reached by a nav item whose page has not shipped yet in this build —
// every route this catches gets a real page in the next pass.
export default function ComingSoon() {
  const terms = useTerms();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <EmptyState
      icon={Construction}
      tone="blocked"
      title="Not built yet"
      description={`There is no page at ${location.pathname} in this build. It is on the way.`}
      secondaryAction={{ label: `Back to your ${terms.batches}`, onClick: () => navigate("/") }}
    />
  );
}
