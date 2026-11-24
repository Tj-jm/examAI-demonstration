// A short ✓ on the button that saved something. Any primary button counts:
// the one clicked last, if a request it started (an RTK Query mutation)
// finishes successfully within a few seconds.
let last = null;

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.(".btn-primary");
      if (button) last = { button, at: Date.now() };
    },
    true
  );
}

export const savedTickMiddleware = () => (next) => (action) => {
  const result = next(action);
  const meta = action?.meta;
  if (last && meta?.requestStatus === "fulfilled" && meta?.arg?.type === "mutation" && Date.now() - last.at < 8000) {
    const { button } = last;
    last = null;
    if (button.isConnected) {
      button.classList.remove("btn-saved");
      void button.offsetWidth; // restart the animation
      button.classList.add("btn-saved");
      setTimeout(() => button.classList.remove("btn-saved"), 1400);
    }
  }
  return result;
};
