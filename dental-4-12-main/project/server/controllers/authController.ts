import type { Request, Response } from "express";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { User } from "../models/index.js";
import { comparePassword, hashPassword } from "../utils/password.js";
import { logAudit } from "../utils/auditLog.js";
import { sendEmail, otpEmailHtml, resetEmailHtml } from "../utils/mailer.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_COOKIE_MAX_AGE_MS,
  REFRESH_COOKIE_MAX_AGE_MS,
} from "../utils/jwt.js";

const isProd = process.env.NODE_ENV === "production";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Token lifetimes + a resend cooldown so repeated requests can't spam Brevo.
// A code/link issued less than RESEND_COOLDOWN_MS ago is reused (no new email).
const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Given an *_expires date and its full TTL, was it issued within the cooldown?
const withinCooldown = (expires: Date | null | undefined, ttlMs: number) =>
  !!expires && Date.now() - (expires.getTime() - ttlMs) < RESEND_COOLDOWN_MS;

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
};

// "Remember me" decides cookie PERSISTENCE, not token lifetime. Omitting
// maxAge makes these session cookies, so closing the browser ends the session
// — the default on shared clinic PCs. When remembered, they persist for the
// token's full lifetime (15 min access / 7 day refresh) as before.
function setAuthCookies(res: Response, accessToken: string, refreshToken: string, remember: boolean) {
  res.cookie("access_token", accessToken, {
    ...baseCookieOptions,
    ...(remember ? { maxAge: ACCESS_COOKIE_MAX_AGE_MS } : {}),
  });
  res.cookie("refresh_token", refreshToken, {
    ...baseCookieOptions,
    ...(remember ? { maxAge: REFRESH_COOKIE_MAX_AGE_MS } : {}),
  });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const remember = req.body.remember === true;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim(), isArchived: false }).select(
    "+password_hash",
  );
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const matches = await comparePassword(password, user.password_hash);
  if (!matches) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // 2FA-enabled accounts get a one-time emailed code instead of cookies —
  // the session only exists after /auth/verify-otp succeeds.
  if (user.twofa_enabled) {
    // Resend cooldown: a code sent in the last 60s is still valid — reuse it
    // rather than emailing another, so repeated logins can't spam sends.
    if (withinCooldown(user.otp_expires, OTP_TTL_MS)) {
      res.json({ twofa_required: true });
      return;
    }
    const code = String(randomInt(100000, 1000000));
    user.otp_hash = sha256(code);
    user.otp_expires = new Date(Date.now() + OTP_TTL_MS);
    await user.save();
    const { subject, html } = otpEmailHtml(code);
    const sent = await sendEmail(user.email, subject, html);
    if (!sent) {
      // Email layer down: fail closed but honestly — the user can't complete
      // 2FA, so don't pretend a code is on its way.
      res.status(503).json({ error: "Could not send the verification code. Try again shortly." });
      return;
    }
    res.json({ twofa_required: true });
    return;
  }

  const payload = { sub: user._id.toString(), role: user.role, school_id: user.school_id?.toString() ?? null };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ ...payload, remember });
  setAuthCookies(res, accessToken, refreshToken, remember);

  user.last_login = new Date();
  await user.save();

  const safeUser = await User.findById(user._id);
  res.json(safeUser);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.refresh_token;
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);
    // Re-check the DB rather than trusting the token's embedded role/school_id
    // — otherwise a deactivated user or one whose role changed keeps their
    // stale permissions for up to 7 days (the refresh token's lifetime),
    // since minting a new access token from the old payload never noticed.
    const user = await User.findById(payload.sub);
    if (!user || user.isArchived) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }
    const accessToken = signAccessToken({
      sub: user._id.toString(),
      role: user.role,
      school_id: user.school_id?.toString() ?? null,
    });
    // Honor the persistence the original login chose (carried in the refresh
    // token) — otherwise a session-only login turns persistent on first refresh.
    res.cookie("access_token", accessToken, {
      ...baseCookieOptions,
      ...(payload.remember ? { maxAge: ACCESS_COOKIE_MAX_AGE_MS } : {}),
    });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}

export function logout(_req: Request, res: Response) {
  res.clearCookie("access_token", baseCookieOptions);
  res.clearCookie("refresh_token", baseCookieOptions);
  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
}

// Self-service password change -- distinct from userController's
// admin-assisted resetPassword: this requires knowing the CURRENT password
// (proves it's really the account owner), whereas the admin-assisted reset
// exists precisely for when that's not possible.
export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const user = await User.findById(req.user!.id).select("+password_hash");
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const matches = await comparePassword(currentPassword, user.password_hash);
  if (!matches) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  user.password_hash = await hashPassword(newPassword);
  await user.save();

  await logAudit(user._id.toString(), "Changed Password", user._id.toString(), "User");

  res.json({ success: true });
}

// Re-authentication step for a sensitive in-app action (e.g. bulk archive) —
// proves it's really the signed-in user typing, without changing anything.
// Same bcrypt check as changePassword's current-password verification.
export async function verifyPassword(req: Request, res: Response) {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: "password is required" });
    return;
  }

  const user = await User.findById(req.user!.id).select("+password_hash");
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const matches = await comparePassword(password, user.password_hash);
  if (!matches) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.json({ valid: true });
}

// Completes a 2FA login: checks the emailed code, then issues the same
// cookie pair a normal login would.
export async function verifyOtp(req: Request, res: Response) {
  const { email, code } = req.body;
  // 2FA logins issue no cookies at /auth/login, so the checkbox has to be
  // re-sent here — this is the request that actually creates the session.
  const remember = req.body.remember === true;
  if (!email || !code) {
    res.status(400).json({ error: "Email and code are required" });
    return;
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim(), isArchived: false }).select(
    "+otp_hash",
  );
  const valid =
    user &&
    user.twofa_enabled &&
    user.otp_hash &&
    user.otp_expires &&
    user.otp_expires > new Date() &&
    user.otp_hash === sha256(String(code).trim());
  if (!valid) {
    res.status(401).json({ error: "Invalid or expired code" });
    return;
  }

  // Single-use: clear before issuing the session
  user.otp_hash = null;
  user.otp_expires = null;
  user.last_login = new Date();

  const payload = { sub: user._id.toString(), role: user.role, school_id: user.school_id?.toString() ?? null };
  setAuthCookies(res, signAccessToken(payload), signRefreshToken({ ...payload, remember }), remember);
  await user.save();

  await logAudit(user._id.toString(), "2FA Login", user._id.toString(), "User");

  const safeUser = await User.findById(user._id);
  res.json(safeUser);
}

// Self-service reset, step 1. ALWAYS responds with the same generic 200 so
// the endpoint can't be used to probe which emails have accounts.
export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim(), isArchived: false });
  // Resend cooldown: if a reset link was issued in the last 60s, don't send
  // another (the earlier one is still valid). Still falls through to the same
  // generic 200 below, so the endpoint stays a black box to probers.
  if (user && !withinCooldown(user.reset_token_expires, RESET_TOKEN_TTL_MS)) {
    const token = randomBytes(32).toString("hex");
    user.reset_token_hash = sha256(token);
    user.reset_token_expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();
    const origin =
      typeof req.headers.origin === "string" && req.headers.origin
        ? req.headers.origin
        : process.env.APP_URL ?? "https://dental-app-build.vercel.app";
    const { subject, html } = resetEmailHtml(`${origin}/reset-password?token=${token}`);
    await sendEmail(user.email, subject, html);
  }

  res.json({ message: "If that email has an account, a reset link is on its way." });
}

// Self-service reset, step 2: the emailed link's token proves ownership.
export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: "Token and password are required" });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const user = await User.findOne({
    reset_token_hash: sha256(String(token)),
    reset_token_expires: { $gt: new Date() },
    isArchived: false,
  }).select("+reset_token_hash");
  if (!user) {
    res.status(401).json({ error: "Invalid or expired reset link. Request a new one." });
    return;
  }

  user.password_hash = await hashPassword(String(password));
  user.reset_token_hash = null;
  user.reset_token_expires = null;
  await user.save();

  await logAudit(user._id.toString(), "Reset Password via Email", user._id.toString(), "User");

  res.json({ success: true });
}
