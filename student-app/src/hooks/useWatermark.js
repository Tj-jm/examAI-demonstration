import { useGetMeQuery } from "../api/authApi";
import { useBranding } from "../BrandingContext";

// The signed-in student's name and phone (or email), drawn over videos —
// or nothing, per Settings → Student app → Name over videos. `hosted` is a
// Bunny/Vimeo/YouTube embed, skipped when the setting is "app".
export default function useWatermark({ hosted = false } = {}) {
  const { data } = useGetMeQuery();
  const { videoWatermark = "all" } = useBranding() || {};
  if (videoWatermark === "off" || (hosted && videoWatermark === "app")) return "";
  return [data?.name, data?.phoneNumber || data?.email].filter(Boolean).join(" · ");
}
