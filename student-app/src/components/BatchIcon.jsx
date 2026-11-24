import { useState } from "react";
import {
  GraduationCap, BookOpen, Calculator, Atom, Globe, Microscope, PenTool,
  Code, Music, Palette, Dumbbell, Languages, Scale, Rocket, Brain, Compass,
  Binary, Dna, Telescope, TrendingUp, Layers, FlaskConical, Landmark, Trophy,
  Puzzle, LineChart, Notebook, Feather, Sigma, Infinity, Component, Orbit,
  Waves, Target, Shapes, FileText, PlayCircle, PenLine, HelpCircle,
  Stethoscope, TestTube, Beaker, Pill, Syringe, HeartPulse,
  Gavel, Briefcase, Building2, Newspaper, Library, BookMarked, ScrollText,
  History, Leaf, Mountain, TreePine, Sprout, Cloud,
  Cpu, Server, Database, Network, Wrench, Hammer,
  Users, MessageCircle, MapPin, Film, Camera, Paintbrush, Guitar, Piano, Drama,
  Award, Medal, ShieldCheck, Fingerprint, Zap, Flame, Anchor,
} from "lucide-react";

// Same preset set and lookup as the admin panel's BatchIcon — the value
// stored on a batch is just the name string, so both apps need to agree on
// what that string means or an icon picked in admin renders as nothing here.
// Must list every name in admin-panel's ICON_PRESETS —
// backend/tests/iconPresets.js fails the test run if they drift apart.
// Exported (not just used internally) because FeatureIcon needs the raw
// components at their actual requested size — BatchIcon below assumes it's
// sitting inside its own square/circle container and scales presets down
// to 55% of `size` to leave room for that container's padding, which is
// the wrong assumption for a feature icon dropped directly into an
// existing container built for a bare lucide icon.
export const COMPONENTS = {
  GraduationCap, BookOpen, Calculator, Atom, Globe, Microscope, PenTool,
  Code, Music, Palette, Dumbbell, Languages, Scale, Rocket, Brain, Compass,
  Binary, Dna, Telescope, TrendingUp, Layers, FlaskConical, Landmark, Trophy,
  Puzzle, LineChart, Notebook, Feather, Sigma, Infinity, Component, Orbit,
  Waves, Target, Shapes, FileText, PlayCircle, PenLine, HelpCircle,
  Stethoscope, TestTube, Beaker, Pill, Syringe, HeartPulse,
  Gavel, Briefcase, Building2, Newspaper, Library, BookMarked, ScrollText,
  History, Leaf, Mountain, TreePine, Sprout, Cloud,
  Cpu, Server, Database, Network, Wrench, Hammer,
  Users, MessageCircle, MapPin, Film, Camera, Paintbrush, Guitar, Piano, Drama,
  Award, Medal, ShieldCheck, Fingerprint, Zap, Flame, Anchor,
};

export default function BatchIcon({ icon, size = 20 }) {
  // A picture that won't load (moved, or its server unreachable) falls back
  // to the default icon instead of a broken image.
  const [broken, setBroken] = useState(null);
  if (icon?.kind === "custom" && icon.value && broken !== icon.value) {
    return (
      <img
        src={icon.value}
        onError={() => setBroken(icon.value)}
        alt=""
        // "inherit" rather than a fixed fraction of `size`: every caller
        // wraps this in its own box with its own border-radius (a plain
        // rounded square on a card, a circle in the batch switcher), and
        // that radius is usually a theme-derived value this component has
        // no way to know. A radius computed independently of the
        // container's own — the previous size*0.22 — only matched it by
        // coincidence, and any mismatch reads as a visible seam or a
        // square corner poking past the container's rounded silhouette
        // ("edge popping") once the image fills the box edge-to-edge.
        // Inheriting the immediate parent's own computed radius can never
        // mismatch it, whatever that parent happens to be.
        style={{ width: size, height: size, borderRadius: "inherit", objectFit: "cover" }}
      />
    );
  }

  // Centred in a box of the full size, so it sits in the middle of
  // whatever container holds it (a bare 55% svg sat in the top-left).
  const Cmp = (icon?.kind !== "custom" && COMPONENTS[icon?.value]) || GraduationCap;
  return (
    <span style={{ width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Cmp size={size * 0.55} />
    </span>
  );
}
