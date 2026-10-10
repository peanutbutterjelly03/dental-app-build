// Autosave plumbing for the Medical History and Dental Chart tabs.
//
// PURE (no React, no network) so the rules are tested on their own.
//
// WHY A SCHEDULER AND NOT JUST "CALL SAVE ON EVERY CHANGE": the save creates a
// record the first time (POST) and updates it afterwards (PUT), and it only
// knows which one to do after it has re-read the student. Two saves in flight
// at once would both see "no record yet" and create it twice. So there is ever
// one run at a time; a change that arrives during a run only sets a flag, and
// the run goes round once more when it finishes (changes made while it was
// saving are sent together, never one request per click).

export interface SaveScheduler {
  /** Ask for a save. `delayMs` 0 = now (a tick, a tooth paint); more = after a
   *  pause (typing), restarted by every further call. */
  request(delayMs?: number): void;
  /** Run now, regardless of any pause, and resolve once nothing is left to
   *  save. Used when leaving the page or finishing an edit. `force` is true for
   *  that run so "wait and see" rules (see Visit 2 below) do not wait. */
  flush(): Promise<void>;
}

export function createSaveScheduler(
  run: (force: boolean) => Promise<void>,
  onIdle?: () => void,
): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let forceNext = false;
  let waiters: Array<() => void> = [];

  const drain = async (force: boolean): Promise<void> => {
    if (running) {
      again = true;
      if (force) forceNext = true;
      return;
    }
    running = true;
    try {
      let f = force;
      do {
        again = false;
        const useForce = f || forceNext;
        forceNext = false;
        f = false;
        try {
          await run(useForce);
        } catch {
          // `run` reports its own failure to the screen; a throw must not stop the
          // loop from going idle, or flush() would never resolve.
          again = false;
        }
      } while (again);
    } finally {
      running = false;
      onIdle?.();
      const w = waiters;
      waiters = [];
      w.forEach((resolve) => resolve());
    }
  };

  return {
    request(delayMs = 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (delayMs <= 0) { void drain(false); return; }
      timer = setTimeout(() => { timer = null; void drain(false); }, delayMs);
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      void drain(true);
      return done;
    },
  };
}

/** Same data, regardless of key order noise. Drafts and the converters that
 *  build them from a saved record produce the same key order, so a plain
 *  JSON comparison is exact for them. */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** True when any TEXT field differs between two drafts. Typing is saved after
 *  a short pause (one keystroke is not one write); a tick or a selection is
 *  saved at once. */
export function hasTextChange(prev: object, next: object): boolean {
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  return Object.keys(n).some((k) => typeof n[k] === 'string' && p[k] !== n[k]);
}
