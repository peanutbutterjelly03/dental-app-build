import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  IDLE_MINUTES,
  IDLE_MS,
  ACTIVITY_KEY,
  LOCK_KEY,
  lastActivity,
  markActivity,
  isLocked,
  setLockedFlag,
} from '../utils/sessionIdle';

// Idle timeout screen. Matches the user's reference screenshot exactly
// (2026-10-06): "Session Expired", a plain Log Out button, 15 minutes. It
// replaced the 2026-10-01 version that had a password box so the same person
// could continue; that is gone, so unsaved work is lost when this appears.
//
// ⚠ "Your session has expired" is TRUE when this appears, not decoration
// (CLAUDE.md: nothing cosmetic): locking ends this device's session on the
// server first, so a new tab cannot walk in.
//
// Shared across tabs through localStorage (see utils/sessionIdle.ts): working in
// one tab keeps every tab alive; locking or unlocking in one does it in all.

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Write the shared timestamp at most this often; pointermove fires constantly. */
const ACTIVITY_WRITE_EVERY_MS = 5000;
const CHECK_EVERY_MS = 15000;

export function SessionLock() {
  const { user, lockSession, logout } = useAuth();
  const [locked, setLocked] = useState(false);
  const lastWrite = useRef(0);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  const lockNow = useCallback(() => {
    if (lockedRef.current) return;
    setLocked(true);
    setLockedFlag(true);
    void lockSession();
  }, [lockSession]);

  const check = useCallback(() => {
    if (lockedRef.current) return;
    if (isLocked() || Date.now() - lastActivity() >= IDLE_MS) lockNow();
  }, [lockNow]);

  // On arrival: another tab may already be locked, or this tab may be reopened
  // after the laptop slept. A missing timestamp (first visit) starts the clock.
  useEffect(() => {
    if (isLocked()) { setLocked(true); return; }
    if (!lastActivity()) markActivity();
    check();
  }, [check]);

  useEffect(() => {
    const onActivity = () => {
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastWrite.current < ACTIVITY_WRITE_EVERY_MS) return;
      lastWrite.current = now;
      markActivity();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCK_KEY) {
        if (e.newValue === '1') setLocked(true);
        else setLocked(false);
      }
      if (e.key === ACTIVITY_KEY) check();
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, [check]);

  if (!locked || !user) return null;

  return (
    // Dimmed and heavily blurred so names and tooth charts behind it cannot be
    // read by whoever walks up to an idle clinic PC.
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-700/60 p-4 backdrop-blur-xl"
      role="dialog" aria-modal="true" aria-labelledby="session-lock-title">
      <div className="w-full max-w-sm rounded-2xl bg-card px-6 py-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          {/* Solid padlock copied from the reference screenshot: thick shackle,
              rounded body, white keyhole. */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-red-600" aria-hidden="true">
            <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            <rect x="4" y="10" width="16" height="11.5" rx="3" fill="currentColor" />
            <circle cx="12" cy="14.8" r="1.6" fill="white" />
            <rect x="11.2" y="15" width="1.6" height="3.2" rx="0.8" fill="white" />
          </svg>
        </div>
        <h2 id="session-lock-title" className="text-xl font-bold text-foreground">Session Expired</h2>
        <p className="mt-4 text-sm leading-relaxed text-foreground">
          You have been inactive for {IDLE_MINUTES} minutes. For your security, your session has expired.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Please log in again to continue using FLORAL.</p>
        {/* This device's session is already over (see lockNow), so the server
            has nothing to stamp and other devices are left alone. */}
        <button type="button" onClick={() => { void logout(); }}
          className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
          Log Out
        </button>
      </div>
    </div>
  );
}
