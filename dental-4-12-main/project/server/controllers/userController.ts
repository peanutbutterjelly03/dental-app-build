import type { Request, Response } from "express";
import { createHash, randomInt, randomBytes } from "node:crypto";
import { User, ROLES } from "../models/index.js";
import { hashPassword } from "../utils/password.js";
import { logAudit } from "../utils/auditLog.js";
import { sendEmail, otpEmailHtml, resetEmailHtml } from "../utils/mailer.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createUser(req: Request, res: Response) {
  const { full_name, email, role, school_id, password } = req.body;

  if (!full_name || !email || !role || !password) {
    res.status(400).json({ error: "full_name, email, role, and password are required" });
    return;
  }
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    return;
  }
  // Length over complexity rules, per NIST guidance — a long passphrase beats
  // a short password with forced special characters.
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const password_hash = await hashPassword(password);
  const user = await User.create({
    full_name,
    email: String(email).toLowerCase().trim(),
    role,
    school_id: school_id || null,
    password_hash,
  });

  await logAudit(req.user!.id, "Created User", user._id.toString(), "User");

  const safeUser = await User.findById(user._id);
  res.status(201).json(safeUser);
}

// Admin-assisted password reset: System Admin sets a new password directly
// for a user who's forgotten theirs, then relays it out-of-band (in person,
// chat, phone) -- no email/reset-token infrastructure needed at this app's
// scale (~10 staff across 3 schools, per CLAUDE.md).
export async function resetPassword(req: Request, res: Response) {
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: "password is required" });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  user.password_hash = await hashPassword(password);
  await user.save();

  await logAudit(req.user!.id, "Reset Password", user._id.toString(), "User");

  res.status(200).json({ success: true });
}

// Admin-initiated password reset via EMAIL — preferred over the direct set
// above. Instead of the admin choosing (and thus knowing) the password, this
// generates a reset token and emails the user a link so they set their own,
// preserving accountability. Same token mechanism as self-service
// forgot-password, but admin-triggered with real success/failure feedback.
// Falls back to the direct set for accounts without a real mailbox.
export async function sendResetLink(req: Request, res: Response) {
  const user = await User.findById(req.params.id);
  if (!user || user.isArchived) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  user.reset_token_hash = sha256(token);
  user.reset_token_expires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  const origin =
    typeof req.headers.origin === "string" && req.headers.origin
      ? req.headers.origin
      : process.env.APP_URL ?? "https://dental-app-build.vercel.app";
  const { subject, html } = resetEmailHtml(`${origin}/reset-password?token=${token}`);
  const sent = await sendEmail(user.email, subject, html);
  if (!sent) {
    res
      .status(503)
      .json({ error: "Could not send the reset email — check the mailbox is real, or set a password directly." });
    return;
  }

  await logAudit(req.user!.id, "Sent Password Reset Link", user._id.toString(), "User");
  res.json({ message: `Reset link sent to ${user.email}` });
}

// 2FA enablement is confirmation-gated: enabling sends a test code to the
// account's email that must be entered back — this proves the mailbox is
// real BEFORE 2FA can lock the account (demo accounts have fake @floral.com
// emails; enabling 2FA on one without this check would be a lockout).
export async function initiateTwofa(req: Request, res: Response) {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.twofa_enabled) {
    res.status(400).json({ error: "Two-factor authentication is already enabled" });
    return;
  }

  const code = String(randomInt(100000, 1000000));
  user.otp_hash = sha256(code);
  user.otp_expires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  const { subject, html } = otpEmailHtml(code);
  const sent = await sendEmail(user.email, subject, html);
  if (!sent) {
    res.status(503).json({ error: "Could not send the confirmation code to this email. Check the address and try again." });
    return;
  }

  res.json({ message: `Confirmation code sent to ${user.email}` });
}

export async function confirmTwofa(req: Request, res: Response) {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const user = await User.findById(req.params.id).select("+otp_hash");
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const valid = user.otp_hash && user.otp_expires && user.otp_expires > new Date() && user.otp_hash === sha256(String(code).trim());
  if (!valid) {
    res.status(401).json({ error: "Invalid or expired code" });
    return;
  }

  user.twofa_enabled = true;
  user.otp_hash = null;
  user.otp_expires = null;
  await user.save();

  await logAudit(req.user!.id, "Enabled 2FA", user._id.toString(), "User");

  res.json({ success: true });
}

export async function disableTwofa(req: Request, res: Response) {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  user.twofa_enabled = false;
  user.otp_hash = null;
  user.otp_expires = null;
  await user.save();

  await logAudit(req.user!.id, "Disabled 2FA", user._id.toString(), "User");

  res.json({ success: true });
}
