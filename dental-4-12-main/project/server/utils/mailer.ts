// Thin Brevo transactional-email client. If BREVO_API_KEY is unset (local
// dev without email), sends are logged and skipped so nothing ever blocks
// on email delivery. Returns true only when Brevo accepted the message.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) {
    console.log(`[mailer] BREVO_API_KEY/SENDER not set — skipping email "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { email: sender, name: "FLORAL Dental Health System" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      console.error(`[mailer] Brevo rejected "${subject}" to ${to}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[mailer] send failed for "${subject}" to ${to}:`, err);
    return false;
  }
}

export function otpEmailHtml(code: string): { subject: string; html: string } {
  return {
    subject: `${code} is your FLORAL login code`,
    html: `<div style="font-family:sans-serif;max-width:420px">
      <h2 style="color:#1E40AF">FLORAL login verification</h2>
      <p>Your one-time login code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
      <p>It expires in 10 minutes. If you didn't try to log in, you can ignore this email — your password alone cannot access the account while two-factor authentication is on.</p>
    </div>`,
  };
}

export function resetEmailHtml(link: string): { subject: string; html: string } {
  return {
    subject: "Reset your FLORAL password",
    html: `<div style="font-family:sans-serif;max-width:420px">
      <h2 style="color:#1E40AF">Password reset</h2>
      <p>Someone (hopefully you) requested a password reset for your FLORAL account.</p>
      <p><a href="${link}" style="background:#1E40AF;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Set a new password</a></p>
      <p>The link expires in 30 minutes and can be used once. If you didn't request this, ignore this email — nothing changes without the link.</p>
    </div>`,
  };
}
