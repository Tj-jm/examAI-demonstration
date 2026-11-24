import { useEffect } from "react";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { isNative } from "./session";

// The screen stays on while this page is open: exams and live classes.
export const useKeepAwake = () => {
  useEffect(() => {
    if (!isNative) return undefined;
    KeepAwake.keepAwake().catch(() => {});
    return () => { KeepAwake.allowSleep().catch(() => {}); };
  }, []);
};
