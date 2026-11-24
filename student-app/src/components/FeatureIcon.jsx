import { GraduationCap } from "lucide-react";
import { useBranding } from "../BrandingContext";
import { COMPONENTS } from "./BatchIcon";

// Renders one of the "jump to" feature icons (lectures, practice, exams,
// results, doubts, etc.) — the admin-customized version if one has been set
// in Settings, otherwise falls back to whatever default component the
// caller passes in.
//
// `size` is the bare lucide glyph's own size — unchanged from before, and
// still what a preset/default renders at. `customSize` is new: a custom
// upload isn't a small glyph, it's typically a pre-made, full-bleed
// circular badge (colour + icon baked into one image, no transparent
// margin around it — confirmed against real admin uploads), so it needs to
// fill the actual container the caller built for it, not sit shrunk down
// to glyph size floating inside a differently-colored ring/box drawn
// around it. Defaults to `size` for any caller that hasn't been told its
// real container size yet, so nothing regresses silently.
export default function FeatureIcon({ featureKey, Default, size = 20, customSize = size, color }) {
  const { featureIcons } = useBranding();
  const custom = featureIcons?.[featureKey];

  if (custom?.kind === "custom" && custom.value) {
    return (
      <img
        src={custom.value}
        alt=""
        style={{ width: customSize, height: customSize, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  if (custom?.kind === "preset" && custom.value) {
    const Cmp = COMPONENTS[custom.value] || GraduationCap;
    return <Cmp size={size} color={color} />;
  }

  return <Default size={size} color={color} />;
}
