import { useState } from "react";

// Hint state for a passage question: each sub-question has its own up-to-3
// hints, asked for separately. Shared by batch practice and the archive
// session. `ask(index, fetchHint)` calls `fetchHint(level, previousHints)`,
// which returns the hint text (the page supplies its own endpoint).
export default function usePassageHints() {
  const [bySub, setBySub] = useState({});
  const [loadingFor, setLoadingFor] = useState(null);

  const ask = async (index, fetchHint) => {
    const previous = bySub[index]?.hints || [];
    setLoadingFor(index);
    setBySub((s) => ({ ...s, [index]: { hints: previous, error: null } }));
    try {
      const hint = await fetchHint(previous.length + 1, previous);
      setBySub((s) => ({ ...s, [index]: { hints: [...previous, hint], error: null } }));
    } catch (error) {
      setBySub((s) => ({
        ...s,
        [index]: {
          hints: previous,
          error: { message: error.data?.message || "Could not get a hint right now.", capReached: error.status === 429 },
        },
      }));
    } finally {
      setLoadingFor(null);
    }
  };

  const reset = () => {
    setBySub({});
    setLoadingFor(null);
  };

  return { bySub, loadingFor, ask, reset };
}
