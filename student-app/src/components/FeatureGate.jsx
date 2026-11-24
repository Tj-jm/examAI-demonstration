import { Lock } from "lucide-react";
import EmptyState from "./EmptyState";

// BatchHome.jsx already hides the "jump to" tile for a feature the moment an
// admin turns it off (batch.features?.X && {...}), but the route behind
// that tile stays mounted regardless (see App.jsx) — a bookmark, browser
// history, or a notification link (NotificationBell.jsx's study-plan-ready
// link, say) still lands directly on the page. Every one of those pages
// fetched `batch` already but never checked batch.features before
// rendering its real content, so a feature turned off after the fact kept
// showing exactly as if it were still on — this is what "toggled a feature
// off but the student panel is still showing it" actually was.
//
// A student without access to a batch's `features` at all yet (batch still
// loading) sees the page's own loading state rather than this — `batch`
// arriving undefined is a loading state, not "the feature is off", so this
// only ever blocks once it can see the real, current flag.
export default function FeatureGate({ batch, feature, label, children }) {
  if (!batch) return children;

  if (!batch.features?.[feature]) {
    return (
      <EmptyState
        icon={Lock}
        tone="blocked"
        title={`${label} isn't available here`}
        description="This has been turned off for this batch."
        variant="inline"
      />
    );
  }

  return children;
}
