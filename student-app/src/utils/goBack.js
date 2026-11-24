// A page's own back arrow: step back in history when the app has somewhere to
// go back to (so the previous page keeps its filters, see hooks/useUrlState.js),
// otherwise open the fallback (a session opened straight from a link).
export default function goBack(navigate, fallback) {
  if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
  else navigate(fallback);
}
