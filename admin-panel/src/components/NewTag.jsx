// "New": arrived since this person last opened the page (hooks/useSeen.js).
export default function NewTag({ show = true }) {
  if (!show) return null;
  return <span className="pill pill-new">New</span>;
}
