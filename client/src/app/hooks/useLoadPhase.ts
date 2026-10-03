import { useCallback, useRef, useState } from 'react';

// Distinguishes the FIRST load of a list from every later refresh.
//
// Every list hook used to call setLoading(true) at the top of reload(), and
// the screens render a full skeleton whenever loading is true — so any
// re-fetch (coming back online, a queued write syncing, a manual refresh)
// blanked the whole page out and rebuilt it, losing scroll position and
// whatever the user was reading. `loading` now goes true only until the first
// successful load; after that data is swapped in place underneath the user.
export function useLoadPhase() {
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);

  const beginLoad = useCallback(() => {
    if (!loadedRef.current) setLoading(true);
  }, []);

  // Called from the finally block, so a failed refresh still counts as "we
  // have painted once" — a later retry shouldn't blank the page either.
  const endLoad = useCallback(() => {
    loadedRef.current = true;
    setLoading(false);
  }, []);

  return { loading, beginLoad, endLoad };
}
