import { useGetPublicSettingsQuery } from "../api/contentApi";

// The institution's own name and logo (Settings → Branding) in the admin
// menu, so a white-labelled install doesn't show "ExamAI" to its staff.
export function useBrand() {
  const { data } = useGetPublicSettingsQuery();
  return { name: data?.siteName || "ExamAI", logo: data?.logo || null };
}

export function NavBrand() {
  const { name, logo } = useBrand();
  return (
    <div className={`nav-brand${logo ? " nav-brand-logo" : ""}`} title={name}>
      {logo && <img src={logo} alt="" className="nav-brand-img" />}
      {name}
    </div>
  );
}
