import { memo, useEffect, useRef, useState, useCallback } from "react";
import {
  Box, AppBar, Toolbar, Typography, Paper, RadioGroup, Radio, FormControlLabel,
  ToggleButtonGroup, ToggleButton, TextField, Button, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Chip, CircularProgress,
  Backdrop, Alert, Drawer, IconButton, Tooltip, Snackbar, Divider,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { Clock, LayoutGrid, Flag, X, Check } from "lucide-react";
import { timerPulse, animate, wiggle, bump, popIn, flash, fadeIn } from "../../motion";
import {
  useStartExamMutation, useSaveAnswerMutation, useLogViolationMutation, useUploadAnswerImageMutation,
  useSubmitExamMutation, useGetBatchQuery,
} from "../../api/contentApi";
import Latex from "../../components/Latex";
import LatexInserter from "../../components/LatexInserter";
import ZoomableImage from "../../components/ZoomableImage";
import useAnswerDoodle from "../../components/useAnswerDoodle";
import CameraCapture from "../../components/CameraCapture";
import { readCache, writeCache, clearCache, isCacheStale } from "../../utils/examCache";
import { tapFeedback } from "../../native/haptics";
import { useKeepAwake } from "../../native/keepAwake";
import { useCalculator } from "../../components/calculator/useCalculator";
import { withPart } from "../../utils/passagePart";
import CodeAnswer from "../../components/CodeAnswer";

const pad = (n) => String(n).padStart(2, "0");
// Set while the phone's camera / photo picker is open for an answer image:
// the page goes hidden then, and that isn't leaving the exam.
let photoPickerOpenUntil = 0;
// When the picker was opened: a focus-back in the first 2 seconds is the
// picker itself opening (some phone browsers), not the student returning.
let photoPickerOpenedAt = 0;

const formatRemaining = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

// One continuous scroll through every question, a sticky timer that never
// stops, autosave on every change, and an explicit confirm before the one
// action that cannot be undone — the same shape a timed exam needs
// regardless of which platform renders it.
export default function ExamTake() {
  useKeepAwake();
  const { batchId, id } = useParams();
  const navigate = useNavigate();

  const [startExam] = useStartExamMutation();
  const [saveAnswer] = useSaveAnswerMutation();
  const [logViolation] = useLogViolationMutation();
  const [uploadAnswerImage] = useUploadAnswerImageMutation();
  const [submitExam, { isLoading: submitting }] = useSubmitExamMutation();
  const { data: batch } = useGetBatchQuery(batchId);
  const imagesAllowed = Boolean(batch?.features?.writtenAnswerImages);
  const cameraOnly = Boolean(batch?.features?.cameraOnlyAnswers);

  // Lazy initializers run once, synchronously, before anything paints — if
  // a non-expired attempt is already cached for this batch+exam, the exam
  // renders immediately from it instead of showing a spinner while the
  // network catches up. A brand new attempt has nothing cached yet, so
  // these come back null and the loading path below runs exactly as it did
  // before this existed.
  const [session, setSession] = useState(() => {
    const cache = readCache(batchId, id);
    return cache && !isCacheStale(cache) ? cache : null;
  });
  const [answers, setAnswers] = useState(() => {
    const cache = readCache(batchId, id);
    return cache && !isCacheStale(cache) ? cache.answers || {} : {};
  });
  const [now, setNow] = useState(Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [warning, setWarning] = useState(null);
  const warnedRef = useRef(false);
  // Flags are intentionally local and not persisted. They are a scratch note
  // for the next twenty minutes, not exam data — syncing them would mean an
  // extra write on every tap during the one activity where writes must not
  // compete with answer autosave.
  const [flagged, setFlagged] = useState({});
  // Bumped on every answer the server has saved: shows "Saved" briefly.
  const [savedTick, setSavedTick] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const questionRefs = useRef({});
  const [loadError, setLoadError] = useState(null);
  const [offline, setOffline] = useState(false);

  const saveTimers = useRef({});
  const autoSubmitted = useRef(false);
  const startRequested = useRef(false);
  // Deliberately separate from startRequested — this tracks whether the
  // component is currently mounted, not whether the request has been sent.
  // React 18 StrictMode's dev-only mount → cleanup → mount cycle flips this
  // false and immediately true again in the same tick, before the network
  // call below has had a chance to resolve, so by the time it does resolve
  // this correctly reads true again. A single combined "cancelled" flag
  // tied to the same effect used to get stuck at false after that cycle —
  // the guarded effect only fires its network call once, but the cleanup
  // from StrictMode's synthetic first pass was still marking that one real
  // call as cancelled, so its result was silently discarded and the screen
  // never left the loading spinner.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Calling start here rather than a plain GET is what makes a page refresh
  // mid-exam resume instead of losing the attempt — the backend endpoint is
  // idempotent, so a fresh start and a resume are the same request. Runs
  // regardless of whether a cache already rendered something above — this
  // is the reconciliation pass, confirming the cached copy still matches
  // what the server thinks is happening (and picking up the real
  // submissionId, the first time, when there was no cache to begin with).
  // The last attempt ran out of time: { message, nextAttempt } until the
  // student chooses to start the next one.
  const [timedOut, setTimedOut] = useState(null);

  const begin = (newAttempt = false) =>
    (async () => {
      try {
        const sentAt = Date.now();
        const reply = await startExam({ batchId, id, ...(newAttempt ? { newAttempt: true } : {}) }).unwrap();
        // How far this device's clock is from the server's, measured at the
        // middle of the request, so the timer shows the real time left.
        const clockOffset = Number.isFinite(reply.serverNow) ? reply.serverNow - (sentAt + Date.now()) / 2 : 0;
        const result = { ...reply, clockOffset };
        if (!mountedRef.current) return;

        const serverAnswers = {};
        for (const a of result.savedAnswers) serverAnswers[a.question] = a;

        // Only trust the cache's answers if it's the *same* attempt the
        // server just confirmed — a cache left over from an earlier,
        // already-finished attempt (a second try, if the exam allows more
        // than one) would otherwise bleed its stale answers into a fresh
        // one. When it does match, a locally-cached answer wins over the
        // server's only where the server has nothing for that question —
        // the one situation that actually needs recovering from is a
        // debounced save that never made it out before a crash; anything
        // the server already has is, by definition, not lost.
        const cache = readCache(batchId, id);
        const merged = { ...serverAnswers };
        if (cache && cache.submissionId === result.submissionId) {
          for (const [qId, local] of Object.entries(cache.answers || {})) {
            if (isAnswered(local) && !isAnswered(merged[qId])) merged[qId] = local;
          }
        }

        setSession(result);
        setAnswers(merged);
        setOffline(false);
        writeCache(batchId, id, result, merged);
      } catch (error) {
        if (!mountedRef.current) return;
        if (error.data?.code === "ATTEMPT_TIMED_OUT") {
          clearCache(batchId, id);
          setSession(null);
          setAnswers({});
          setTimedOut(error.data);
          return;
        }
        // A cached, not-yet-expired attempt is already on screen — don't
        // yank it away over a failed sync. The student keeps working from
        // the local copy; the debounced saves and the eventual submit will
        // surface a real problem if there is one, rather than this one
        // background check ending the attempt over what might just be a
        // dropped connection.
        if (session) {
          setOffline(true);
        } else {
          setLoadError(error.data?.message || "Could not start this exam.");
        }
      }
    })();

  useEffect(() => {
    if (startRequested.current) return;
    startRequested.current = true;
    begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Flag-only exam integrity: logs when the tab is switched away from or
  // the window is minimized while the attempt is in progress. Reads
  // document.hidden via visibilitychange — the one reliable, low-noise
  // signal (a plain window "blur" also fires on far too many harmless
  // things, like clicking the browser's own address bar, to be worth
  // logging on its own). Never blocks, warns, or changes anything about
  // the attempt — this exists purely for whoever grades the paper
  // afterward to see, not to police the student while they're taking it.
  // Coming back stamps the flag, so the grader sees how long they were away.
  const awayRef = useRef(false);
  // Set below: leaves for the result once the server has closed the attempt.
  const endedRef = useRef(null);
  useEffect(() => {
    if (!session) return;

    const comeBack = () => {
      if (!awayRef.current) return;
      awayRef.current = false;
      // Away longer than the exam allows: the server has ended it.
      logViolation({ submissionId: session.submissionId, type: "back" }).unwrap()
        .then((reply) => { if (reply?.ended) endedRef.current?.(); })
        .catch(() => {});
    };
    let blurTimer = null;

    const onVisibilityChange = () => {
      // Back from the camera (or its cancel): leaving for it wasn't leaving.
      if (!document.hidden) {
        photoPickerOpenUntil = 0;
        comeBack();
        return;
      }
      clearTimeout(blurTimer);
      if (Date.now() < photoPickerOpenUntil || awayRef.current) return;
      awayRef.current = true;
      logViolation({ submissionId: session.submissionId, type: "tab-hidden" });
    };

    // Another window in front while the exam is still on screen. Waits 2
    // seconds (a tab switch hides the page in that time and is flagged
    // above instead). Focus inside an embedded frame on the page is not leaving.
    const onBlur = () => {
      if (session.watch?.leftWindow === false) return;
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (document.hidden || document.hasFocus() || awayRef.current) return;
        if (Date.now() < photoPickerOpenUntil) return;
        if (document.activeElement?.tagName === "IFRAME") return;
        awayRef.current = true;
        logViolation({ submissionId: session.submissionId, type: "window-blur" });
      }, 2000);
    };

    // A computer's file picker never hides the page, so the pause above
    // would last its full 5 minutes. The window getting focus back ends it.
    const onFocus = () => {
      clearTimeout(blurTimer);
      if (photoPickerOpenUntil && !document.hidden && Date.now() - photoPickerOpenedAt > 2000) photoPickerOpenUntil = 0;
      if (!document.hidden) comeBack();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [session, logViolation]);

  // Server time: the device's clock corrected by the measured offset.
  const serverTime = now + (session?.clockOffset || 0);
  // Only when this exam allows it (calculatorAllowed on the server).
  useCalculator(session?.calculator === true);
  const deadline = session ? new Date(session.startedAt).getTime() + session.durationMinutes * 60000 : null;
  const remainingMs = deadline ? deadline - serverTime : null;
  const timeUp = remainingMs !== null && remainingMs <= 0;

  // Relative to this exam's own length, not a flat five minutes — a fixed
  // absolute threshold means a 6-minute exam spends almost its entire
  // length "urgent" while a 3-hour one gets no warning until the last
  // 2.8% of it. 20% of the total duration remaining (80% elapsed) scales
  // with the exam the way a student's own sense of "running out of time"
  // does.
  const totalMs = session ? session.durationMinutes * 60000 : null;
  const warningThresholdMs = totalMs !== null ? totalMs * 0.2 : null;

  // A script-upload grace period only ever applies to an exam with at least
  // one written question, and only when the creator configured one (0, the
  // default, is off). Once the main timer runs out, every other input locks
  // but the image-attach control on a written question stays live for this
  // extra stretch — see QuestionCard's `locked` prop below.
  const hasWritten = session ? session.questions.some((q) => q.type === "written" || (q.subQuestions || []).some((sq) => sq.type === "written")) : false;
  const graceMs = hasWritten ? (session?.scriptGraceMinutes || 0) * 60000 : 0;
  const graceDeadline = deadline !== null && graceMs > 0 ? deadline + graceMs : null;
  const graceActive = timeUp && graceDeadline !== null && serverTime < graceDeadline;
  const graceRemainingMs = graceDeadline !== null ? graceDeadline - serverTime : null;
  // The actual "nothing left to do, submit now" signal: the main timer when
  // there's no grace period, the end of the grace window when there is one.
  const finalTimeUp = graceDeadline !== null ? serverTime >= graceDeadline : timeUp;

  // Back (browser, phone or Android button) asks first while the exam is
  // running: one extra history entry catches it. Leaving is flagged for the
  // teacher, and coming back to the exam stamps how long they were out.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const guardRef = useRef(false);
  // Set when this page steps back off its extra entry on purpose: the
  // result page to go to, or "leave".
  const exitRef = useRef(null);
  const submissionId = session?.submissionId;

  useEffect(() => {
    if (!submissionId) return;
    if (!guardRef.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      guardRef.current = true;
    }
    const onPop = () => {
      const exit = exitRef.current;
      if (exit === "leave") return;
      if (exit) {
        exitRef.current = null;
        navigate(exit, { replace: true });
        return;
      }
      guardRef.current = false;
      if (!autoSubmitted.current) setLeaveOpen(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [submissionId, navigate]);

  const stay = () => {
    setLeaveOpen(false);
    if (!guardRef.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      guardRef.current = true;
    }
  };

  const leave = () => {
    setLeaveOpen(false);
    logViolation({ submissionId, type: "left-exam" });
    exitRef.current = "leave";
    window.history.back();
  };

  const doSubmit = useCallback(async (alreadyClosed = false) => {
    if (!session || autoSubmitted.current) return;
    autoSubmitted.current = true;
    try {
      if (!alreadyClosed) await submitExam(session.submissionId).unwrap();
      tapFeedback();
      // A moment of "Submitted ✓" before the result page.
      setSubmitted(true);
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      clearCache(batchId, id);
      setLeaveOpen(false);
      const result = `/submissions/${session.submissionId}`;
      if (guardRef.current) {
        // Off the extra entry first, so Back from the result skips the exam.
        guardRef.current = false;
        exitRef.current = result;
        window.history.back();
      } else {
        navigate(result, { replace: true });
      }
    }
  }, [session, submitExam, navigate, batchId, id]);

  useEffect(() => {
    if (finalTimeUp) doSubmit();
  }, [finalTimeUp, doSubmit]);
  endedRef.current = () => doSubmit(true);

  // An 80%-elapsed warning that interrupts, because the colour change on
  // the timer chip does not. A student heads-down on a question can miss a
  // chip shifting hue in the corner entirely, and the next thing that
  // happens is the paper submitting itself.
  //
  // It carries the unanswered count rather than just the time, since "three
  // still blank" is what actually changes how the remaining time gets
  // spent. Fires once — a warning that reappears is an alarm, and an alarm
  // during an exam is its own problem.
  useEffect(() => {
    if (!session || warnedRef.current) return;
    if (remainingMs === null || warningThresholdMs === null) return;
    if (remainingMs > warningThresholdMs || remainingMs <= 0) return;

    warnedRef.current = true;

    const blank = session.questions.filter((q) => !answeredQ(q, answers)).length;
    const left = formatRemaining(remainingMs);

    setWarning(
      blank === 0
        ? `${left} left. Everything is answered — you can submit whenever you are ready.`
        : `${left} left, ${blank} question${blank === 1 ? "" : "s"} still unanswered.`
    );

    // Android honours this; iOS Safari ignores it silently, which is why it
    // is a bonus on top of the visible warning rather than the warning
    // itself. Wrapped because a page served over plain http has no
    // navigator.vibrate at all.
    try {
      navigator.vibrate?.([120, 60, 120]);
    } catch {
      // A device that will not buzz is not a reason to interrupt the exam.
    }
  }, [remainingMs, warningThresholdMs, session, answers, timeUp]);

  const updateAnswer = (questionId, patch) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: { ...prev[questionId], question: questionId, ...patch } };
      // Written immediately, not debounced like the server save below — the
      // whole point of this copy is to still exist if the tab closes before
      // that debounce ever fires.
      if (session) writeCache(batchId, id, session, next);
      return next;
    });

    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(() => {
      saveAnswer({ submissionId: session.submissionId, questionId, ...patch })
        .unwrap()
        .then(() => setSavedTick((n) => n + 1))
        .catch(() => {});
    }, 600);
  };

  // The clock re-renders this page every second. QuestionCard is memoised
  // and these three handlers keep the same identity across renders, so only
  // the header clock updates each tick, not every question's maths.
  const latest = useRef({});
  latest.current = { updateAnswer, session };
  const toggleFlagFor = useCallback((questionId) => setFlagged((f) => ({ ...f, [questionId]: !f[questionId] })), []);
  const changeFor = useCallback((questionId, patch) => latest.current.updateAnswer(questionId, patch), []);
  const logViolationFor = useCallback(
    (type) => logViolation({ submissionId: latest.current.session?.submissionId, type }),
    [logViolation]
  );

  if (timedOut) {
    return (
      <Box sx={{ p: 3, maxWidth: 520 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Time ran out on your last attempt</Typography>
        <Typography color="text.secondary" sx={{ mb: 2.5 }}>{timedOut.message}</Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="contained" onClick={() => { setTimedOut(null); begin(true); }}>
            Start attempt {timedOut.nextAttempt}
          </Button>
          {timedOut.submissionId && (
            <Button variant="outlined" onClick={() => navigate(`/submissions/${timedOut.submissionId}`)}>See the result</Button>
          )}
          <Button onClick={() => navigate(`/batches/${batchId}/exams`)}>Not now</Button>
        </Box>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography color="error" sx={{ mb: 2 }}>{loadError}</Typography>
        <Button variant="outlined" onClick={() => navigate(`/batches/${batchId}/exams/${id}`)}>Back</Button>
      </Box>
    );
  }

  if (!session) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const answeredCount = session.questions.filter((q) => answeredQ(q, answers)).length;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="transparent" sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ justifyContent: "space-between", gap: 1 }}>
          {/* The count was previously just a label. On a long paper the most
              urgent question a student has is "which ones did I miss", and
              the answer was buried in a scroll — so the count is now the way
              in to the navigator. */}
          <Button
            size="small"
            onClick={() => setNavOpen(true)}
            startIcon={<LayoutGrid size={15} />}
            sx={{ fontWeight: 500, textTransform: "none", flexShrink: 1, minWidth: 0 }}
          >
            <Box component="span" sx={{ whiteSpace: "nowrap" }}>
              <Box component="span" key={answeredCount} sx={{ display: "inline-block", ...(answeredCount > 0 ? animate(bump, 320) : {}) }}>{answeredCount}</Box>/{session.questions.length} answered
            </Box>
          </Button>

          <Chip
            icon={<Clock size={14} />}
            label={graceActive ? `Grace ${formatRemaining(graceRemainingMs)}` : formatRemaining(remainingMs)}
            // Three states, not two. Red at sixty seconds is an announcement,
            // not a warning — by then there is nothing useful left to do with
            // the information. Five minutes is the point where a student can
            // still change what they spend the rest of the time on.
            color={
              graceActive
                ? "warning"
                : remainingMs < 60000
                  ? "error"
                  : warningThresholdMs !== null && remainingMs < warningThresholdMs
                    ? "warning"
                    : "default"
            }
            sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, ...(graceActive ? {} : timerPulse(remainingMs, warningThresholdMs)) }}
          />
        </Toolbar>
      </AppBar>

      {savedTick > 0 && (
        <Box
          key={savedTick}
          role="status"
          sx={{
            position: "fixed", right: 16, bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: 1200, pointerEvents: "none",
            display: "flex", alignItems: "center", gap: 0.5, px: 1.25, py: 0.5, borderRadius: 5,
            bgcolor: "background.paper", border: 1, borderColor: "divider", boxShadow: 1,
            fontSize: 13, color: "success.main",
            ...animate(flash, 1600, "ease-out", "both"),
          }}
        >
          <Check size={14} /> Saved
        </Box>
      )}

      {offline && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Could not reach the server just now — still working from your last saved copy. Your answers are being kept locally and will sync once the connection is back.
        </Alert>
      )}

      {graceActive && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          Time's up — every answer is locked now. You have {formatRemaining(graceRemainingMs)} left to
          attach photographed answer scripts, then this submits automatically.
        </Alert>
      )}

      <Box sx={{ maxWidth: 700, mx: "auto", p: { xs: 2, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
        {session.questions.map((q, index) => (
          <Box key={q._id} ref={(el) => { questionRefs.current[q._id] = el; }}>
            <QuestionCard
              index={index}
              question={q}
              answer={answers[q._id]}
              partAnswers={q.type === "passage" ? answers : undefined}
              flagged={Boolean(flagged[q._id])}
              onToggleFlag={toggleFlagFor}
              onChange={changeFor}
              imagesAllowed={imagesAllowed}
              cameraOnly={cameraOnly}
              submissionId={session.submissionId}
              uploadAnswerImage={uploadAnswerImage}
              onLogViolation={logViolationFor}
              locked={timeUp}
            />
          </Box>
        ))}

        <Button
          variant="contained"
          size="large"
          onClick={() => setConfirmOpen(true)}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" }, px: 4 }}
        >
          Submit exam
        </Button>
      </Box>

      <QuestionNavigator
        open={navOpen}
        onClose={() => setNavOpen(false)}
        questions={session.questions}
        answers={answers}
        flagged={flagged}
        onJump={(questionId) => {
          setNavOpen(false);
          // Scroll after the drawer has begun closing, or the sticky header
          // ends up covering the question that was just jumped to.
          setTimeout(() => {
            questionRefs.current[questionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 120);
        }}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Submit this exam?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {answeredCount} of {session.questions.length} question{session.questions.length === 1 ? "" : "s"} answered.
            {answeredCount < session.questions.length && " Unanswered questions score zero."}
            {" "}This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Keep working</Button>
          <Button variant="contained" onClick={() => { setConfirmOpen(false); doSubmit(); }}>Submit</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={leaveOpen} onClose={stay}>
        <DialogTitle>Your exam is still running</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The timer keeps going while you're away, and leaving the exam is noted for your teacher. Your answers so far are saved.
            {(session.awayMode === "submit" || session.awayMode === "abandon") && (
              <>
                {" "}If you're away for more than {session.awayMinutes} minute{session.awayMinutes === 1 ? "" : "s"},{" "}
                {session.awayMode === "abandon" ? "this attempt ends and scores zero." : "this attempt is submitted with what's saved."}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={leave}>Leave anyway</Button>
          <Button variant="contained" onClick={stay}>Stay in the exam</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(warning)}
        onClose={() => setWarning(null)}
        // No autoHideDuration: this is the one message in the app that must
        // not vanish before it has been read, and the student dismisses it
        // either by closing it or by acting on it.
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ mb: { xs: 1, sm: 2 } }}
      >
        <Alert
          severity="warning"
          variant="filled"
          onClose={() => setWarning(null)}
          action={
            <>
              <Button
                color="inherit"
                size="small"
                onClick={() => { setWarning(null); setNavOpen(true); }}
              >
                Review
              </Button>
              <IconButton size="small" color="inherit" onClick={() => setWarning(null)} aria-label="Dismiss">
                <X size={16} />
              </IconButton>
            </>
          }
          sx={{ alignItems: "center" }}
        >
          {warning}
        </Alert>
      </Snackbar>

      <Backdrop open={submitting || submitted} sx={{ zIndex: (t) => t.zIndex.modal + 1, color: "#fff", flexDirection: "column", gap: 2 }}>
        {submitted ? (
          <>
            <Box sx={{ width: 64, height: 64, borderRadius: "50%", bgcolor: "success.main", display: "flex", alignItems: "center", justifyContent: "center", ...animate(popIn, 420, "cubic-bezier(.2,.7,.3,1.4)") }}>
              <Check size={34} strokeWidth={3} />
            </Box>
            <Typography sx={animate(fadeIn, 300, "ease-out", "150ms both")}>Submitted</Typography>
          </>
        ) : (
          <>
            <CircularProgress color="inherit" />
            <Typography>Submitting…</Typography>
          </>
        )}
      </Backdrop>
    </Box>
  );
}

const isAnswered = (a) => {
  if (!a) return false;
  if (a.selectedOption !== undefined && a.selectedOption !== null) return true;
  if (a.answerText && String(a.answerText).trim()) return true;
  // A written answer can be photos of the script alone.
  if (Array.isArray(a.answerImages) && a.answerImages.length > 0) return true;
  if (Array.isArray(a.statementAnswers) && a.statementAnswers.length > 0) return true;
  if (Array.isArray(a.subAnswers) && a.subAnswers.length > 0) return true;
  return false;
};

// A passage counts as answered once any question under it is, written ones
// included (their answers are kept under "<passage>:<index>").
const answeredQ = (q, answers) =>
  isAnswered(answers[q._id]) || (q.type === "passage" && (q.subQuestions || []).some((sq, si) => sq.type === "written" && isAnswered(answers[`${q._id}:${si}`])));

const QuestionCard = memo(function QuestionCard({
  index, question, answer, partAnswers, flagged, onToggleFlag: toggleFlagFor, onChange: changeFor, imagesAllowed, cameraOnly, submissionId,
  uploadAnswerImage, onLogViolation, locked,
}) {
  const onToggleFlag = () => toggleFlagFor(question._id);
  const onChange = (patch) => changeFor(question._id, patch);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 3 },
        borderRadius: 3,
        // A flagged question is findable by scrolling too, not only through
        // the navigator.
        borderColor: flagged ? "warning.main" : "divider",
      }}
    >
      <Box sx={{ display: "flex", gap: 1.5, mb: 2 }}>
        <Typography sx={{ fontWeight: 500, color: "text.secondary" }}>{index + 1}.</Typography>
        <Box sx={{ flex: 1 }}>
          {question.questionImage?.url && (
            <ZoomableImage src={question.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
          )}
          <Latex as="div">{question.question}</Latex>
        </Box>

        <Tooltip title={flagged ? "Remove flag" : "Flag to come back to"}>
          <IconButton
            size="small"
            onClick={onToggleFlag}
            aria-label={flagged ? "Remove flag" : "Flag to come back to"}
            sx={{ alignSelf: "flex-start", color: flagged ? "warning.main" : "text.secondary" }}
          >
            <Box component="span" key={String(flagged)} sx={{ display: "inline-flex", transformOrigin: "20% 90%", ...(flagged ? animate(wiggle, 500, "ease-in-out") : {}) }}>
              <Flag size={16} fill={flagged ? "currentColor" : "none"} />
            </Box>
          </IconButton>
        </Tooltip>
      </Box>

      {question.type === "mcq" && (
        <RadioGroup
          value={answer?.selectedOption ?? ""}
          onChange={(e) => onChange({ selectedOption: e.target.value })}
          sx={{ pl: 3.5 }}
        >
          {question.options.map((opt) => (
            <FormControlLabel
              key={opt.key}
              value={opt.key}
              control={<Radio size="small" />}
              label={
                <Box>
                  {opt.image?.url && (
                    <ZoomableImage
                      src={opt.image.url}
                      sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: opt.text ? 0.5 : 0 }}
                    />
                  )}
                  {opt.text && <Latex>{opt.text}</Latex>}
                </Box>
              }
              disabled={locked}
              sx={{
                borderRadius: 2,
                mx: 0,
                mb: 0.5,
                py: 0.3,
                // Top-align only matters when an image is stacked under the
                // text — otherwise the radio's own (taller) click box sits
                // top-anchored against a single short line and the dot reads
                // as floating below the option text instead of beside it.
                alignItems: opt.image?.url ? "flex-start" : "center",
              }}
            />
          ))}
        </RadioGroup>
      )}

      {question.type === "mtf" && (
        <Box sx={{ pl: 3.5, display: "flex", flexDirection: "column", gap: 1 }}>
          {question.statements.map((s, si) => {
            const current = (answer?.statementAnswers || []).find((sa) => sa.index === si);
            return (
              <Box key={si} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                <Latex as="span" style={{ fontSize: 14 }}>{s.text}</Latex>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={current?.value ?? null}
                  onChange={(e, value) => {
                    if (value === null) return;
                    const rest = (answer?.statementAnswers || []).filter((sa) => sa.index !== si);
                    onChange({ statementAnswers: [...rest, { index: si, value }] });
                  }}
                >
                  <ToggleButton value={true} disabled={locked}>True</ToggleButton>
                  <ToggleButton value={false} disabled={locked}>False</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            );
          })}
        </Box>
      )}

      {question.type === "passage" && (
        <Box sx={{ pl: 3.5, display: "flex", flexDirection: "column", gap: 2.5 }}>
          {question.subQuestions.map((sq, si) => {
            const current = (answer?.subAnswers || []).find((sa) => sa.index === si);
            return (
              <Box key={si}>
                {si > 0 && <Divider sx={{ mb: 2.5 }} />}
                <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: "text.secondary" }}>
                    {index + 1}.{si + 1}
                  </Typography>
                  <Box sx={{ flex: 1 }}>
                    {sq.questionImage?.url && (
                      <ZoomableImage src={sq.questionImage.url} sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />
                    )}
                    <Latex as="div" style={{ fontSize: 14 }}>{sq.question}</Latex>
                  </Box>
                </Box>
                {sq.type === "written" ? (
                  <WrittenAnswer
                    answer={partAnswers?.[`${question._id}:${si}`]}
                    onChange={(patch) => changeFor(`${question._id}:${si}`, patch)}
                    question={{ ...withPart(question, si), _id: `${question._id}:${si}` }}
                    imagesAllowed={imagesAllowed} cameraOnly={cameraOnly} submissionId={submissionId}
                    uploadAnswerImage={uploadAnswerImage} onLogViolation={onLogViolation} locked={locked}
                  />
                ) : (
                <RadioGroup
                  value={current?.selectedOption ?? ""}
                  onChange={(e) => {
                    const rest = (answer?.subAnswers || []).filter((sa) => sa.index !== si);
                    onChange({ subAnswers: [...rest, { index: si, selectedOption: e.target.value }] });
                  }}
                  sx={{ pl: 3 }}
                >
                  {sq.options.map((opt) => (
                    <FormControlLabel
                      key={opt.key}
                      value={opt.key}
                      control={<Radio size="small" />}
                      label={
                        <Box>
                          {opt.image?.url && (
                            <ZoomableImage
                              src={opt.image.url}
                              sx={{ display: "block", maxWidth: "100%", maxHeight: 160, borderRadius: 1, mb: opt.text ? 0.5 : 0 }}
                            />
                          )}
                          {opt.text && <Latex>{opt.text}</Latex>}
                        </Box>
                      }
                      disabled={locked}
                      sx={{
                        borderRadius: 2,
                        mx: 0,
                        mb: 0.5,
                        py: 0.3,
                        alignItems: opt.image?.url ? "flex-start" : "center",
                      }}
                    />
                  ))}
                </RadioGroup>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {question.type === "coding" && (
        <CodeAnswer question={question} answer={answer} onChange={onChange} submissionId={submissionId} locked={locked} />
      )}

      {question.type === "written" && (
        <WrittenAnswer
          answer={answer} onChange={onChange} question={question} imagesAllowed={imagesAllowed} cameraOnly={cameraOnly}
          submissionId={submissionId} uploadAnswerImage={uploadAnswerImage} onLogViolation={onLogViolation} locked={locked}
        />
      )}
    </Paper>
  );
});

// A written answer box: text (with maths) and, when the batch allows,
// photos of the script. Also used for a passage's written questions.
function WrittenAnswer({ answer, onChange, question, imagesAllowed, cameraOnly, submissionId, uploadAnswerImage, onLogViolation, locked }) {
  const writtenRef = useRef(null);
  return (
        <Box sx={{ pl: 3.5 }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
        <LatexInserter
          inputRef={writtenRef}
          value={answer?.answerText || ""}
          onChange={(text) => onChange({ answerText: text })}
        />
      </Box>
      <TextField
        inputRef={writtenRef}
        multiline
        minRows={4}
        fullWidth
        disabled={locked}
        placeholder="Write your answer here"
        value={answer?.answerText || ""}
        onChange={(e) => onChange({ answerText: e.target.value })}
        onPaste={() => onLogViolation("answer-paste")}
      />
      {(answer?.answerText || "").includes("$") && (
        <Box
          sx={{
            mt: 0.75,
            p: 1,
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Preview
          </Typography>
          <Latex as="div">{answer.answerText}</Latex>
        </Box>
      )}
      {question.wordLimit && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
          About {question.wordLimit} words expected.
        </Typography>
      )}
      {imagesAllowed && (
        <AnswerImageUploader
          images={answer?.answerImages || []}
          onChange={(images) => onChange({ answerImages: images })}
          submissionId={submissionId}
          uploadAnswerImage={uploadAnswerImage}
          question={question}
          locked={locked}
          cameraOnly={cameraOnly}
        />
      )}
    </Box>
  );
}

const MAX_ANSWER_IMAGES = 10;
const NO_CAMERA_NOTE = "That image has no camera data, so it looks like a screenshot or a saved picture. It is flagged for your teacher. Attach photos of your own handwritten work.";

// One or more photographed pages of working, attached alongside (or
// instead of) typed text — for a subject where the actual work is more
// naturally done on paper than typed out. Only rendered at all when this
// batch's writtenAnswerImages toggle is on (see BatchDetail.jsx); the
// images themselves ride along on the exact same autosave path answerText
// already uses, via the same onChange({ answerImages }) call.
//
// "Draw answer" opens the drawing pad instead (useAnswerDoodle.jsx): not
// once time is up, and a pad still open then attaches what's drawn.
//
// With cameraOnly (the batch's cameraOnlyAnswers), photos come from the
// in-app camera only, never the gallery or a file.
function AnswerImageUploader({ images, onChange, submissionId, uploadAnswerImage, question, locked, cameraOnly }) {
  const inputRef = useRef(null);
  const [camera, setCamera] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const doodle = useAnswerDoodle({
    images,
    onChange,
    upload: async (file, { drawn } = {}) => (await uploadAnswerImage({ submissionId, file, drawn }).unwrap()).url,
    maxImages: MAX_ANSWER_IMAGES,
    draftKey: `exam:${submissionId}:${question._id}`,
    forceAttach: locked,
    question,
  });

  const pick = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // same file can be picked again after a failure
    if (file) add(file);
  };

  const add = async (file, { camera } = {}) => {
    if (images.length >= MAX_ANSWER_IMAGES) {
      setError(`Up to ${MAX_ANSWER_IMAGES} images per answer.`);
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const result = await uploadAnswerImage({ submissionId, file, camera }).unwrap();
      onChange([...images, result.url]);
      if (result.noCamera) setError(NO_CAMERA_NOTE);
    } catch (err) {
      setError(err.data?.message || "Could not upload that image.");
    } finally {
      setUploading(false);
    }
  };

  const remove = (url) => onChange(images.filter((u) => u !== url));

  return (
    <Box sx={{ mt: 1.5 }}>
      {images.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1 }}>
          {images.map((url) => (
            <Box key={url} sx={{ position: "relative" }}>
              <Box component="img" src={url} alt="" sx={{ width: 72, height: 72, objectFit: "cover", borderRadius: 1.5, display: "block", border: "1px solid", borderColor: "divider" }} />
              <IconButton
                size="small"
                onClick={() => remove(url)}
                sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", boxShadow: 1, width: 22, height: 22, "&:hover": { bgcolor: "background.paper" } }}
              >
                <X size={12} />
              </IconButton>
              {!locked && doodle.editButton(url)}
            </Box>
          ))}
        </Box>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <Button
        size="small"
        variant="outlined"
        disabled={uploading || images.length >= MAX_ANSWER_IMAGES}
        onClick={() => {
          if (cameraOnly) { setCamera(true); return; }
          photoPickerOpenUntil = Date.now() + 5 * 60000;
          photoPickerOpenedAt = Date.now();
          inputRef.current?.click();
        }}
      >
        {uploading ? "Uploading…" : cameraOnly ? (images.length > 0 ? "Take another photo" : "Take a photo") : images.length > 0 ? "Add another image" : "Attach an image"}
      </Button>
      {cameraOnly && <CameraCapture open={camera} onClose={() => setCamera(false)} onCapture={(f) => add(f, { camera: true })} />}
      {!locked && <Box component="span" sx={{ ml: 1 }}>{doodle.button}</Box>}
      {doodle.pad}
      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>{error}</Typography>
      )}
    </Box>
  );
}


// The grid a student actually needs at minute forty: every question at once,
// colour-coded, tap to jump. Without it, "which three did I leave blank" on a
// fifty-question paper means scrolling the whole thing with a clock running —
// the point at which the interface starts working against the person using it.
function QuestionNavigator({ open, onClose, questions, answers, flagged, onJump }) {
  const unanswered = questions.filter((q) => !answeredQ(q, answers));
  const flaggedList = questions.filter((q) => flagged[q._id]);

  return (
    <Drawer anchor="bottom" open={open} onClose={onClose}>
      <Box sx={{ p: 2.5, maxWidth: 640, mx: "auto", width: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
          <Typography sx={{ fontWeight: 500 }}>Questions</Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <X size={17} />
          </IconButton>
        </Box>

        {/* Stated in plain words as well as colour: under time pressure a
            legend is one more thing to decode, and colour alone excludes
            anyone who cannot separate these hues. */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {unanswered.length === 0
            ? "Every question answered."
            : `${unanswered.length} still unanswered`}
          {flaggedList.length > 0 && `, ${flaggedList.length} flagged`}
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))", gap: 1 }}>
          {questions.map((q, index) => {
            const answered = answeredQ(q, answers);
            const isFlagged = Boolean(flagged[q._id]);

            return (
              <Button
                key={q._id}
                onClick={() => onJump(q._id)}
                variant={answered ? "contained" : "outlined"}
                aria-label={`Question ${index + 1}, ${answered ? "answered" : "not answered"}${isFlagged ? ", flagged" : ""}`}
                sx={{
                  minWidth: 0,
                  height: 44,
                  p: 0,
                  fontWeight: 500,
                  position: "relative",
                  // Flagged wins the border, answered wins the fill, so a
                  // question can show both states at once.
                  borderColor: isFlagged ? "warning.main" : undefined,
                  borderWidth: isFlagged ? 2 : undefined,
                  // The grid pops in square by square when opened.
                  ...animate(popIn, 260, "ease-out", `${Math.min(index, 30) * 15}ms both`),
                  ...(isFlagged ? { "&:hover": { borderWidth: 2, borderColor: "warning.main" } } : null),
                }}
              >
                {index + 1}
                {isFlagged && (
                  <Box
                    sx={{
                      position: "absolute", top: 3, right: 3,
                      width: 6, height: 6, borderRadius: "50%", bgcolor: "warning.main",
                    }}
                  />
                )}
              </Button>
            );
          })}
        </Box>

        {unanswered.length > 0 && (
          <Button
            fullWidth
            variant="text"
            sx={{ mt: 2 }}
            onClick={() => onJump(unanswered[0]._id)}
          >
            Go to first unanswered
          </Button>
        )}
      </Box>
    </Drawer>
  );
}
