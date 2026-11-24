import { Sparkles } from "lucide-react";
import { useAiCheckAssignmentHandInMutation } from "../api/contentApi";
import { ErrorNote } from "./bits";

// "Check with AI" on an assignment hand-in (Standard and up): fills in a
// suggested grade and feedback for the grader to accept or change.
export default function AssignmentAiCheck({ subId, onSuggestion }) {
  const [check, { isLoading, error }] = useAiCheckAssignmentHandInMutation();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        className="btn btn-quiet"
        style={{ alignSelf: "flex-start" }}
        disabled={isLoading}
        onClick={async () => { const s = await check(subId).unwrap(); onSuggestion?.(s); }}
      >
        <Sparkles size={15} /> {isLoading ? "Checking" : "Check with AI"}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}
