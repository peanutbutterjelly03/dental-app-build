// Lets a previously-valid session survive a page reload while offline.
// Auth itself is never queued (see api/client.ts) — logging in requires a
// real round trip — but if you were already validly logged in and simply
// lose connectivity, you shouldn't be locked out of the app you were just
// using. Only used as a fallback when /api/auth/me fails due to a network
// error, never when the server actually says 401 (real logout).
import type { ApiRole } from '../api/types';

const KEY = 'floral_cached_user';

export interface CachedUser {
  id: string;
  name: string;
  email: string;
  role: ApiRole;
  schools: string[];
}

// Mirrors the auth cookies' persistence: a "Remember me" login caches into
// localStorage (survives a browser close, like its 7-day cookie), a plain one
// into sessionStorage (dies with the tab, like its session cookie). Without
// this split, an un-remembered login would leave the identity behind in
// localStorage and the offline-restore path could resurrect it after close.
export function saveUserCache(user: CachedUser, remember: boolean): void {
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    store.setItem(KEY, JSON.stringify(user));
    other.removeItem(KEY);
  } catch {
    // storage unavailable (private browsing, quota) — offline session
    // restore just won't work this time, not worth failing the login over.
  }
}

export function loadUserCache(): CachedUser | null {
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// True when the last login opted into "Remember me" — used to re-save the
// cache into the same storage on an /auth/me restore, where the checkbox
// value itself is long gone.
export function wasRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearUserCache(): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
