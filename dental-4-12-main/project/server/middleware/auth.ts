import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string; school_ids: string[] };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    // school_ids is what `utils/schoolScope.ts` turns into a query filter —
    // Sprint 101 shipped that enforcement. (This comment said the opposite,
    // "carried but NOT yet enforced", until 2026-09-11; it sat at the exact
    // spot a reader checks to learn whether scoping is on.)
    //
    // ⚠ An EMPTY array means ALL SCHOOLS, not "no schools" — see User.ts and
    // scopeFilter. That is deliberate for system_admin and bho_staff, and it
    // is why there is no way to express "assigned to nothing" (SEC-04).
    req.user = { id: payload.sub, role: payload.role, school_ids: payload.school_ids ?? [] };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** The testing-mode switch (see requireRole). Read per call, so a test can flip it. */
export const isTestingMode = () => process.env.OPEN_ACCESS_TESTING === "true";

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // ⚠ TESTING MODE (2026-10-01, user's decision): with OPEN_ACCESS_TESTING=true
    // every SIGNED-IN user passes every role check, so the classmate can test
    // the live site without switching accounts. Sign-in is still required.
    // Removing the variable restores normal RBAC; no code changes back.
    // MUST be off before defense and real use (CLAUDE.md AUTH RULES).
    if (isTestingMode()) {
      next();
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
