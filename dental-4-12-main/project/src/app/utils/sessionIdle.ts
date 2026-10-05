// Idle-timeout bookkeeping (2026-10-01), shared by AuthContext and SessionLock.
//
// Both values live in localStorage so every tab of the app agrees: activity in
// one tab keeps the others alive, and a lock in one tab locks them all. They
// hold a timestamp and a flag, nothing that identifies anyone.

/** Minutes without mouse, keyboard, touch or scroll before the session locks. */
export const IDLE_MINUTES = 30;
export const IDLE_MS = IDLE_MINUTES * 60 * 1000;

export const ACTIVITY_KEY = 'floral-last-activity';
export const LOCK_KEY = 'floral-session-locked';

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage unavailable: this tab still times out on its own */ }
}

export const lastActivity = (): number => Number(read(ACTIVITY_KEY)) || 0;
export const markActivity = () => write(ACTIVITY_KEY, String(Date.now()));
export const isLocked = (): boolean => read(LOCK_KEY) === '1';
export const setLockedFlag = (on: boolean) => write(LOCK_KEY, on ? '1' : null);

/** A fresh sign-in starts a fresh idle clock, so an old timestamp from a
 *  previous visit can never lock a session the moment it begins. */
export const startIdleClock = () => { markActivity(); setLockedFlag(false); };
/** Logging out leaves nothing behind for the next person's session. */
export const clearIdleClock = () => { write(ACTIVITY_KEY, null); setLockedFlag(false); };
