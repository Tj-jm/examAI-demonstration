import { Link } from "react-router-dom";

// The "launcher" navigation (Settings → Appearance): on the overview, every
// page this account can open as a tile, by section, with what is waiting in
// it. The overview's own content follows below.
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Launcher({ me, sections, countOf }) {
  const total = sections.reduce((n, sec) => n + sec.items.reduce((m, x) => m + countOf(x), 0), 0);
  const first = String(me?.name || "").split(/\s+/)[0];
  return (
    <div className="launcher">
      <div className="launcher-head">
        <h1>{greeting()}{first ? `, ${first}` : ""}</h1>
        <p className="muted">{total > 0 ? `${total} thing${total === 1 ? " is" : "s are"} waiting on you.` : "Nothing is waiting on you right now."}</p>
      </div>
      {sections.map((sec) => {
        const items = sec.items.filter((x) => x.to !== "/");
        if (!items.length) return null;
        return (
          <section key={sec.name}>
            <div className="launcher-group">{sec.name}</div>
            <div className="launcher-grid">
              {items.map((x) => {
                const { Icon } = x;
                const n = countOf(x);
                return (
                  <Link key={x.to} to={x.to} className={`launcher-tile${n > 0 ? " launcher-tile-busy" : ""}`}>
                    <span className="launcher-icon"><Icon size={19} strokeWidth={1.9} /></span>
                    <span className="launcher-label">{x.label}</span>
                    {n > 0 && <span className="launcher-count tnum">{n} waiting</span>}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
