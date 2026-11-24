import { useCallback, useEffect, useRef, useState } from "react";
import { useGetBadgesQuery, useMarkSeenMutation } from "../api/badgeApi";

// For a page with a sidebar badge: remembers when this person last opened
// it (before this visit), marks it seen now and again on leaving, and
// returns isNew(date): true for anything that arrived since that last
// visit. A first ever visit marks nothing as new.
export function useSeen(key) {
  const { data } = useGetBadgesQuery(undefined, { pollingInterval: 60000, skipPollingIfUnfocused: true });
  const [mark] = useMarkSeenMutation();
  const prev = useRef(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (prev.current !== undefined || !data) return;
    const at = data.seen?.[key];
    prev.current = at ? new Date(at) : null;
    setReady(true);
    mark(key);
  }, [data, key, mark]);
  useEffect(() => () => { if (prev.current !== undefined) mark(key); }, [key, mark]);

  return useCallback(
    (date) => Boolean(ready && prev.current && date && new Date(date) > prev.current),
    [ready],
  );
}

// Is anything on this page newer than this person's last visit?
export const hasNew = (badges, key) => {
  const latest = badges?.latest?.[key];
  const seen = badges?.seen?.[key];
  return Boolean(latest && seen && new Date(latest) > new Date(seen));
};
