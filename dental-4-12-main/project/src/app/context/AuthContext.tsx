import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { apiClient, ApiError } from '../api/client';
import { saveUserCache, loadUserCache, clearUserCache, wasRemembered } from '../offline/authCache';
import type { ApiUser, ApiRole, ApiSchool } from '../api/types';

interface User {
  id: string;
  name: string;
  email: string;
  role: ApiRole;
  schools: string[]; // assigned schools (resolved school names)
}

interface LoginResult {
  ok: boolean;
  // Password was correct but the account requires an emailed code —
  // the UI must show the OTP step; no session exists yet.
  twofaRequired?: boolean;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  selectedSchool: string | null;
  /** False until the user has chosen a school (or explicitly chosen all). */
  schoolChoiceMade: boolean;
  setSelectedSchool: (school: string | null) => void;
  login: (email: string, password: string, remember: boolean) => Promise<LoginResult>;
  verifyOtp: (email: string, code: string, remember: boolean) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Survives reloads/deep-links (school choice used to live only in memory, so
// every refresh bounced users back to the select-school screen).
const SCHOOL_KEY = 'selected-school';
// Set after a successful login/restore. When absent we skip the /auth/me
// probe entirely — an unauthenticated probe just 401s and litters the console.
// Stored in the same tier as the auth cookie: localStorage for a "Remember me"
// login, sessionStorage otherwise, so an un-remembered session doesn't leave a
// hint behind that makes the next browser launch probe a dead session.
const SESSION_HINT_KEY = 'has-session';

function setSessionHint(remember: boolean) {
  try {
    (remember ? window.localStorage : window.sessionStorage).setItem(SESSION_HINT_KEY, '1');
    (remember ? window.sessionStorage : window.localStorage).removeItem(SESSION_HINT_KEY);
  } catch {
    // storage unavailable — worst case we probe /auth/me once and 401
  }
}

function hasSessionHint(): boolean {
  try {
    return (
      window.sessionStorage.getItem(SESSION_HINT_KEY) !== null ||
      window.localStorage.getItem(SESSION_HINT_KEY) !== null
    );
  } catch {
    return false;
  }
}

function clearSessionHint() {
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
    window.sessionStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // nothing to do
  }
}

/** Stored when the user deliberately chooses "All schools".
 *
 *  A plain null cannot mean that: RootLayout redirects to the school gate
 *  whenever `selectedSchool` is null, so "all" and "not chosen yet" have to be
 *  distinguishable. Every SCREEN still reads `selectedSchool === null` as "all",
 *  which is what it already meant — only the persisted value is special. */
export const ALL_SCHOOLS = '__ALL__';

/**
 * A short, stable tag for a user id.
 *
 * NOT cryptography and not claimed to be: FNV-1a, and anyone holding the list
 * of user ids could match tags to them. Its only job is that the value sitting
 * in localStorage is no longer a REAL user id, which is the one part of the
 * 2026-08-25 audit report that was independently verified (backlog #21).
 *
 * Why this and not "just clear it on logout": the id is what stops a second
 * person on a shared clinic PC inheriting the first one's school. Removing it
 * would either re-ask every returning user or hand them someone else's school.
 * Tagging keeps the guard and drops the disclosure.
 *
 * Synchronous on purpose — `initialSchoolFor` derives initial state, so a
 * SubtleCrypto digest (async) would ripple through the provider's first render.
 */
function userTag(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function loadStoredSchool(userId: string, schools: string[]): string | null {
  try {
    const raw = window.localStorage.getItem(SCHOOL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    // Records written before the tag change hold a raw `userId`. Honour one
    // that matches so a returning user is not re-asked, but REWRITE it in the
    // new shape immediately — otherwise the raw id would sit there until the
    // user next changed school, which is the leak this is closing.
    if (typeof parsed.userId === 'string') {
      const matches = parsed.userId === userId;
      storeSchool(userId, matches ? (parsed.school ?? null) : null);
      if (!matches) return null;
    } else if (parsed.u !== userTag(userId)) {
      // A value stored by a DIFFERENT user on this machine.
      return null;
    }
    if (parsed.school === ALL_SCHOOLS) return ALL_SCHOOLS;
    return schools.includes(parsed.school) ? parsed.school : null;
  } catch {
    return null;
  }
}

function storeSchool(userId: string, school: string | null) {
  try {
    if (school === null) window.localStorage.removeItem(SCHOOL_KEY);
    else window.localStorage.setItem(SCHOOL_KEY, JSON.stringify({ u: userTag(userId), school }));
  } catch {
    // storage unavailable (private mode etc.) — selection just won't persist
  }
}

// Restore the stored choice, or auto-select for single-school accounts so
// they never have to click through a one-card selection screen.
function initialSchoolFor(user: User): string | null {
  const stored = loadStoredSchool(user.id, user.schools);
  if (stored) return stored;
  if (user.schools.length === 1) {
    storeSchool(user.id, user.schools[0]);
    return user.schools[0];
  }
  return null;
}

async function resolveUser(apiUser: ApiUser): Promise<User> {
  const allSchools = await apiClient.get<ApiSchool[]>('/schools');
  // Empty assignment means ALL schools (Sprint 100) — the same meaning the old
  // single `school_id: null` carried. A user with two of three schools now
  // gets a switcher listing exactly those two, which the single FK could not
  // express at all.
  const assigned = apiUser.school_ids ?? [];
  const schools = assigned.length
    ? allSchools.filter((s) => assigned.includes(s._id)).map((s) => s.school_name)
    : allSchools.map((s) => s.school_name);

  return {
    id: apiUser._id,
    name: apiUser.full_name,
    email: apiUser.email,
    role: apiUser.role,
    schools,
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // The RAW stored choice: a school name, ALL_SCHOOLS, or null for "not chosen
  // yet". Consumers get the mapped value below.
  const [schoolChoice, setSelectedSchoolState] = useState<string | null>(null);
  const selectedSchool = schoolChoice === ALL_SCHOOLS ? null : schoolChoice;
  /** False only before the user has made a choice — what the gate keys on. */
  const schoolChoiceMade = schoolChoice !== null;

  useEffect(() => {
    (async () => {
      if (!hasSessionHint()) {
        // Never logged in from this browser (or logged out) — don't probe
        // /auth/me just to receive a 401.
        setLoading(false);
        return;
      }
      try {
        const apiUser = await apiClient.get<ApiUser>('/auth/me');
        const resolved = await resolveUser(apiUser);
        setUser(resolved);
        saveUserCache(resolved, wasRemembered());
        setSelectedSchoolState(initialSchoolFor(resolved));
      } catch (err) {
        // A real 401 means the server checked and said you're logged out —
        // trust it. A network error just means we couldn't ask, which isn't
        // the same thing: if you were validly logged in before losing
        // connectivity, don't lock you out of the app you were just using.
        if (err instanceof ApiError) {
          setUser(null);
          clearUserCache();
          clearSessionHint();
        } else {
          const cached = loadUserCache();
          setUser(cached);
          if (cached) setSelectedSchoolState(initialSchoolFor(cached));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setSelectedSchool = useCallback(
    (school: string | null) => {
      setSelectedSchoolState(school);
      if (user) storeSchool(user.id, school);
    },
    [user],
  );

  const completeLogin = useCallback(async (apiUser: ApiUser, remember: boolean) => {
    const resolved = await resolveUser(apiUser);
    setUser(resolved);
    saveUserCache(resolved, remember);
    setSessionHint(remember);
    setSelectedSchoolState(initialSchoolFor(resolved));
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean): Promise<LoginResult> => {
    try {
      const data = await apiClient.post<ApiUser | { twofa_required: true }>('/auth/login', { email, password, remember });
      if ('twofa_required' in data) {
        return { ok: false, twofaRequired: true };
      }
      await completeLogin(data, remember);
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No connection — can\'t log in while offline. If you were logged in before, reopen the app without reloading.';
      return { ok: false, error: message };
    }
  }, [completeLogin]);

  const verifyOtp = useCallback(async (email: string, code: string, remember: boolean): Promise<LoginResult> => {
    try {
      const apiUser = await apiClient.post<ApiUser>('/auth/verify-otp', { email, code, remember });
      await completeLogin(apiUser, remember);
      return { ok: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'No connection — try again when back online.';
      return { ok: false, error: message };
    }
  }, [completeLogin]);

  const logout = useCallback(async () => {
    await apiClient.post('/auth/logout').catch(() => {});
    setUser(null);
    clearUserCache();
    clearSessionHint();
    setSelectedSchoolState(null);
    // Deliberately keep SCHOOL_KEY: logging back in on the same machine
    // shouldn't re-ask a question the user already answered. Since Sprint 125
    // the stored record holds a TAG rather than the user id, so what survives
    // logout no longer identifies who was here (backlog #21).
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, selectedSchool, schoolChoiceMade, setSelectedSchool, login, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
