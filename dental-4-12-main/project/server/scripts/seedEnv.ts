// Shared secret guard for the seed scripts.
//
// Sprint 15.5 made these values required (no hardcoded fallback). That stopped
// a MISSING value but not a PLACEHOLDER one: `.env.example` ships
// SEED_*_PASSWORD=choose-a-password, and seedDemo happily hashed that literal
// string and created four working accounts with it, printing "Created ... user"
// and warning about nothing (found by the Sprint 112 fresh-clone rehearsal —
// all four logged in with it). The placeholder is a public string in a
// committed file, so that is a known credential, not a weak one.
//
// Refuses the same way purgeDemoData.ts does: a plain message naming the
// variable, then a non-zero exit — no stack trace.

import { isPlaceholderSecret } from "../utils/secretGuard.js";

const MIN_LENGTH = 8;

function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Read an env var that will become a real credential. Refuses if it is
 * missing, still the `.env.example` placeholder, or too short to be a
 * password at all.
 */
export function requireSecretEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) {
    refuse(`${name} must be set in .env — no hardcoded fallback (see Sprint 15.5 security fix).`);
  }

  const value = raw.trim();
  if (isPlaceholderSecret(value)) {
    refuse(
      `${name} is still the .env.example placeholder ("${value}") — refusing to seed.\n` +
        `That value is a public string in a committed file, so any account created with it\n` +
        `is a known credential. Set a real value in .env and run this again.`
    );
  }
  if (value.length < MIN_LENGTH) {
    refuse(`${name} is only ${value.length} characters — set at least ${MIN_LENGTH} before seeding.`);
  }

  return raw;
}

/**
 * Validate every named secret BEFORE touching the database, so a bad value
 * cannot leave a half-seeded database behind.
 */
export function requireSecretEnvAll(names: string[]): void {
  for (const name of names) requireSecretEnv(name);
}
