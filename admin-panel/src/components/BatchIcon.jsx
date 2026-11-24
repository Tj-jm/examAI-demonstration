import { useState } from "react";
import {
  GraduationCap, BookOpen, Calculator, Atom, Globe, Microscope, PenTool,
  Code, Music, Palette, Dumbbell, Languages, Scale, Rocket, Brain, Compass,
  Binary, Dna, Telescope, TrendingUp, Layers, FlaskConical, Landmark, Trophy,
  Puzzle, LineChart, Notebook, Feather, Sigma, Infinity, Component, Orbit,
  Waves, Target, Shapes, FileText, PlayCircle, PenLine, HelpCircle,
  // Expanded set — every name below was checked against the installed
  // lucide-react version before being added here, so none of these are a
  // guess that could 404 into a blank icon at runtime.
  Stethoscope, TestTube, Beaker, Pill, Syringe, HeartPulse,
  Gavel, Briefcase, Building2, Newspaper, Library, BookMarked, ScrollText,
  History, Leaf, Mountain, TreePine, Sprout, Cloud,
  Cpu, Server, Database, Network, Wrench, Hammer,
  Users, MessageCircle, MapPin, Film, Camera, Paintbrush, Guitar, Piano, Drama,
  Award, Medal, ShieldCheck, Fingerprint, Zap, Flame, Anchor,
} from "lucide-react";

// A fixed set rather than every lucide icon — the picker is a grid someone
// scans in a couple of seconds to find "the chemistry one", not a search
// box. Adding to this list is safe any time; the string stored on a batch
// is the key, not the component, so old batches keep rendering correctly
// even if this list grows around them.
export const ICON_PRESETS = [
  "GraduationCap", "BookOpen", "Calculator", "Atom", "FlaskConical", "Dna",
  "Microscope", "Globe", "Landmark", "Scale", "Languages", "PenTool",
  "Code", "Binary", "Telescope", "Compass", "Brain", "Rocket",
  "TrendingUp", "Layers", "Music", "Palette", "Dumbbell", "Trophy",
  "Puzzle", "LineChart", "Notebook", "Feather", "Sigma", "Infinity",
  "Component", "Orbit", "Waves", "Target", "Shapes", "FileText",
  "PlayCircle", "PenLine", "HelpCircle",
  "Stethoscope", "TestTube", "Beaker", "Pill", "Syringe", "HeartPulse",
  "Gavel", "Briefcase", "Building2", "Newspaper", "Library", "BookMarked", "ScrollText",
  "History", "Leaf", "Mountain", "TreePine", "Sprout", "Cloud",
  "Cpu", "Server", "Database", "Network", "Wrench", "Hammer",
  "Users", "MessageCircle", "MapPin", "Film", "Camera", "Paintbrush", "Guitar", "Piano", "Drama",
  "Award", "Medal", "ShieldCheck", "Fingerprint", "Zap", "Flame", "Anchor",
];

// Matches Batch.icon's schema default exactly (backend/models/batchModel.js)
// — IconPicker's "Reset to default" reads from here rather than a second
// hardcoded "GraduationCap" string that could drift out of sync with it.
export const DEFAULT_ICON = "GraduationCap";

const COMPONENTS = {
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

// Renders whatever a batch's icon actually is — a preset name looked up
// against the map above, or a custom uploaded image — behind one
// consistent shape so nothing calling this needs to know which kind it got.
export default function BatchIcon({ icon, size = 20, imgSize = 36 }) {
  // A picture that won't load falls back to the default icon.
  const [broken, setBroken] = useState(null);
  if (icon?.kind === "custom" && icon.value && broken !== icon.value) {
    return (
      <img
        src={icon.value}
        onError={() => setBroken(icon.value)}
        alt=""
        style={{ width: imgSize, height: imgSize, borderRadius: 8, objectFit: "cover" }}
      />
    );
  }

  const Cmp = (icon?.kind !== "custom" && COMPONENTS[icon?.value]) || GraduationCap;
  return <Cmp size={size} />;
}
