// Placeholder detection for the values in `.env.example`.
//
// `.env.example` is committed, so it can only hold fake values — that part is
// deliberate and correct. The defect this guards is the code ACCEPTING one as
// if it were real: until Sprint 113, `seed:demo` hashed the literal
// "choose-a-password" and created four working accounts with it, silently
// (found by the Sprint 112 fresh-clone rehearsal). This module is the single
// source of truth for "that value is not a real secret", shared by the seed
// scripts and the app's startup check.

/** Exact `.env.example` values, plus the placeholders people invent. */
const PLACEHOLDER_VALUES = new Set([
  "choose-a-password",
  "replace-with-a-long-random-string",
  "replace-with-a-different-long-random-string",
  "must-match-the-key-existing-records-were-encrypted-with",
  "changeme",
  "change-me",
  "password",
  "secret",
  "test",
  "admin",
]);

/**
 * Substrings that only ever appear in the template. MONGODB_URI cannot be
 * matched exactly — a real string differs in every field but these.
 */
const PLACEHOLDER_FRAGMENTS = ["CLUSTER.mongodb.net", "USER:PASSWORD"];

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (PLACEHOLDER_VALUES.has(v.toLowerCase())) return true;
  return PLACEHOLDER_FRAGMENTS.some((f) => v.includes(f));
}

/** Secrets the app itself reads. Seed passwords are guarded in seedEnv.ts. */
const GUARDED_AT_STARTUP = ["MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "FIELD_ENCRYPTION_SECRET"];

/**
 * Warn — never throw — when a real secret is still a template value.
 *
 * WARNS rather than refuses on purpose: this runs on Vercel's serverless boot,
 * and a hard exit here would take the live site down on a misconfiguration
 * instead of degrading. Tighten to a refusal only once the deployed values
 * have been confirmed real (backlog #49). Returns the offending names so a
 * caller or test can assert on them.
 */
export function checkStartupSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];

  for (const name of GUARDED_AT_STARTUP) {
    const value = env[name];
    if (!value) {
      problems.push(name);
      console.warn(`[secret-guard] ${name} is not set — the app will misbehave rather than fail cleanly.`);
      continue;
    }
    if (isPlaceholderSecret(value)) {
      problems.push(name);
      console.warn(
        `[secret-guard] ${name} is still the .env.example placeholder — it is a public string in a committed file, so treat it as compromised and replace it.`
      );
    }
  }

  return problems;
}
