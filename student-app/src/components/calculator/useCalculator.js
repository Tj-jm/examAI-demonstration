import { useEffect, useSyncExternalStore } from "react";

// A page or dialog that offers the calculator calls useCalculator(allowed).
// One calculator is drawn for the whole app (CalculatorHost), shown while
// anything open asks for it, so a dialog over a page doesn't add a second.
let wanted = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const useCalculator = (allowed = true) => {
  useEffect(() => {
    if (!allowed) return undefined;
    wanted += 1;
    emit();
    return () => { wanted -= 1; emit(); };
  }, [allowed]);
};

export const useCalculatorWanted = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => wanted > 0, () => false);
