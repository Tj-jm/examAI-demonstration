import { LayoutDashboard, FileQuestion, Megaphone, Users, Sparkles, Settings, LogOut } from "lucide-react";
import { useBrand } from "./Brand";

// The "dock" and "launcher" navigation (Settings → Appearance): the staff
// nav (Shell.jsx NAV, already filtered for this account) cut into its
// sections. Links before the first group form "Overview"; the unnamed last
// group is "More".
const SECTION_ICONS = { Overview: LayoutDashboard, Content: FileQuestion, Marketing: Megaphone, People: Users, AI: Sparkles, More: Settings };

export const sectionsOf = (nav) => {
  const out = [{ name: "Overview", Icon: SECTION_ICONS.Overview, items: [] }];
  for (const item of nav) {
    if (item.group !== undefined) {
      const name = item.group || "More";
      out.push({ name, Icon: SECTION_ICONS[name] || LayoutDashboard, items: [] });
    } else out[out.length - 1].items.push(item);
  }
  return out.filter((sec) => sec.items.length);
};

// The dark strip of section icons. A section with one page goes straight
// there; any other opens its pages beside the strip. A dot: something is
// waiting in that section.
export function DockRail({ sections, open, countOf, onPick, onSignOut }) {
  const brand = useBrand();
  return (
    <aside className="dock-rail">
      {brand.logo ? <img src={brand.logo} alt="" className="dock-mark dock-mark-logo" title={brand.name} /> : <span className="dock-mark" title={brand.name} />}
      {sections.map((sec) => {
        const waiting = sec.items.some((x) => countOf(x) > 0);
        const { Icon } = sec;
        return (
          <button key={sec.name} type="button" className={`dock-btn${sec.name === open ? " dock-btn-on" : ""}`} title={sec.name} onClick={() => onPick(sec)}>
            <Icon size={20} strokeWidth={1.9} />
            {waiting && <span className="dock-dot" />}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button type="button" className="dock-btn" title="Sign out" onClick={onSignOut}><LogOut size={19} strokeWidth={1.9} /></button>
    </aside>
  );
}
