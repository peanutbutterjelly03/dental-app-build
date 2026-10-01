import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
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

// Idle timeout lock screen (2026-10-01). Design from the user's reference
// screenshot ("Session Expired"), with one change the user chose: a password
// field instead of a bare Log Out, so the SAME person signs back in and keeps
// whatever they had not saved yet.
//
// ⚠ "Your session has expired" is TRUE when this appears, not decoration
// (CLAUDE.md: nothing cosmetic): locking ends this device's session on the
// server first, so a new tab cannot walk in. The page stays mounted behind an
// opaque layer, so unsaved work survives but nothing on it is readable.
//
// Shared across tabs through localStorage (see utils/sessionIdle.ts): working in
// one tab keeps every tab alive; locking or unlocking in one does it in all.

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Write the shared timestamp at most this often; pointermove fires constantly. */
const ACTIVITY_WRITE_EVERY_MS = 5000;
const CHECK_EVERY_MS = 15000;

export function SessionLock() {
  const { user, lockSession, unlock, logout } = useAuth();
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twofa, setTwofa] = useState(false);
  const [busy, setBusy] = useState(false);
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
        else { setLocked(false); setPassword(''); setError(null); setTwofa(false); }
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

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const result = await unlock(password);
    setBusy(false);
    if (result.ok) {
      setLocked(false);
      setPassword('');
      return;
    }
    if (result.twofaRequired) { setTwofa(true); return; }
    setError(result.error ?? 'Incorrect password.');
  };

  if (!locked || !user) return null;

  return (
    // Opaque on purpose: a blurred page still shows names and tooth charts to
    // whoever walks up to an idle clinic PC.
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/95 p-4 backdrop-blur-xl"
      role="dialog" aria-modal="true" aria-labelledby="session-lock-title">
      <div className="w-full max-w-md rounded-2xl bg-card px-6 py-8 text-center shadow-2xl sm:px-8">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-50">
          <Lock className="h-8 w-8 text-red-600" fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h2 id="session-lock-title" className="text-xl font-bold text-foreground">Session Expired</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          You have been inactive for {IDLE_MINUTES} minutes. For your security, your session has expired.
        </p>

        {twofa ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            This account uses two-step verification, so it cannot be unlocked here. Log out and sign in again
            from the login page.
          </p>
        ) : (
          <form onSubmit={handleUnlock} className="mt-5 space-y-3 text-left">
            <p className="text-sm text-muted-foreground">
              Enter your password to continue where you left off.
            </p>
            <div className="rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-semibold text-foreground">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </div>
            <label htmlFor="session-lock-password" className="sr-only">Password</label>
            <div className="relative">
              <input
                id="session-lock-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Password"
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <button type="submit" disabled={!password || busy}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60">
              {busy ? 'Signing in...' : 'Log In'}
            </button>
          </form>
        )}

        {/* Not a full-account logout: this device's session is already over,
            and the server has no session to stamp, so other devices are left
            alone (see authController.logout). */}
        <button type="button" onClick={() => { void logout(); }}
          className={twofa
            ? 'mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-hover'
            : 'mt-4 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'}>
          {twofa ? 'Log Out' : 'Not you? Log out'}
        </button>
      </div>
    </div>
  );
}
