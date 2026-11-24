import { useState } from "react";
import { useParams } from "react-router-dom";
import { useGetBatchesQuery } from "../api/contentApi";

// Lectures, exams and practice are each reachable two ways: from the main
// nav, with no batch chosen yet, or from a specific batch's own home page
// (BatchHome), already inside that batch's context. Those two entry points
// used to be two different screens — the nav one went through BatchGate, a
// standalone "choose a batch" page, before landing on the real content one
// navigation later. Results never had that extra step: it is one page, with
// a batch filter inline at the top when there is more than one to choose
// from. This hook is what lets the other three pages behave the same way,
// without losing the direct link BatchHome already depends on.
//
// If the route carries a :batchId (reached from BatchHome, or a bookmarked
// link), that wins and no switcher is shown — the student already chose a
// batch to be here. Otherwise the batch is local component state, starting
// on the first enrolled batch, exactly like Results defaults to "All
// batches" until the student picks something else.
export function useActiveBatch() {
  const params = useParams();
  const { data, isLoading: loadingBatches } = useGetBatchesQuery();
  const [selected, setSelected] = useState(null);

  const enrolled = data?.enrolled || [];
  const fromRoute = Boolean(params.batchId);
  const batchId = params.batchId || selected || enrolled[0]?._id || null;
  const activeBatch = enrolled.find((b) => b._id === batchId) || null;
  const showSwitcher = !fromRoute && enrolled.length > 1;

  return { batchId, activeBatch, enrolled, loadingBatches, showSwitcher, fromRoute, setActiveBatch: setSelected };
}
