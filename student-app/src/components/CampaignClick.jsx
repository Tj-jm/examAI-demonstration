import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCampaignClickMutation } from "../api/accountApi";

// A campaign's links carry ?c=<campaign> (backend utils/campaigns.js). This
// reports the open once, then takes the parameter out of the address.
export default function CampaignClick() {
  const location = useLocation();
  const navigate = useNavigate();
  const [report] = useCampaignClickMutation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("c");
    if (!id || !/^[a-f0-9]{24}$/i.test(id)) return;
    report(id);
    params.delete("c");
    const rest = params.toString();
    navigate(`${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`, { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
