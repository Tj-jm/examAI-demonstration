// A second, client-side copy of the current attempt — deadline, questions,
// and answers — so the exam survives a crash, a closed tab, or a real power
// failure without waiting on the network to find out where things stood.
// The server (Submission, via startExam/saveAnswer) stays the source of
// truth; this is a resilience layer underneath it, not a replacement for
// it — every write here happens alongside the existing server autosave, and
// on reconnect the server's copy is reconciled against this one rather than
// blindly trusted or blindly discarded.
//
// Keyed by batch+exam rather than submissionId, deliberately: the id isn't
// known until the server has already answered once, and the whole point is
// to have something to read before that round trip completes.

const key = (batchId, examId) => `examai:attempt:${batchId}:${examId}`;

export function readCache(batchId, examId) {
  try {
    const raw = localStorage.getItem(key(batchId, examId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupted JSON, or localStorage unavailable (private mode, quota) —
    // either way, fall through to the network path as if there were no
    // cache. This layer is additive; its own failure should never be what
    // breaks the exam.
    return null;
  }
}

export function writeCache(batchId, examId, session, answers) {
  try {
    localStorage.setItem(
      key(batchId, examId),
      JSON.stringify({ ...session, answers, cachedAt: Date.now() })
    );
  } catch {
    // Same reasoning as above — a failed write here just means this one
    // resilience layer is unavailable, not that the exam itself failed.
  }
}

export function clearCache(batchId, examId) {
  try {
    localStorage.removeItem(key(batchId, examId));
  } catch {
    // nothing to do — if it couldn't be written, it doesn't need clearing
  }
}

export function isCacheStale(cache) {
  if (!cache) return true;
  const deadline =
    new Date(cache.startedAt).getTime() +
    cache.durationMinutes * 60000 +
    (cache.bufferSeconds || 0) * 1000;
  return Date.now() + (cache.clockOffset || 0) > deadline;
}
