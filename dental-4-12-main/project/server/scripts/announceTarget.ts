// Every script says WHICH database it is about to touch, before it touches it.
//
// Sprint 126, from backlog #26 (no separation between dev and production data:
// one Atlas cluster serves both, and `.env` on a dev machine points at it).
// The 2026-09-04 session produced three live examples in one day -- a test
// record POSTed to production while proving a validator, a migration run
// against it, and a real pupil transferred -- all recoverable, none of which
// should have been possible to do inattentively.
//
// This does NOT fix #26. A second cluster is still the fix, and it needs the
// user. What this removes is the "I did not realise that was production"
// failure: 13 of the 21 maintenance scripts wrote to the database and only 5
// printed which one.
//
// Set PRODUCTION_DB_HOST in .env to get the loud banner. Unset, the target is
// still printed -- knowing the host is most of the value.
import mongoose from "mongoose";

export function announceTarget(scriptName: string): { isProduction: boolean; host: string } {
  const conn = mongoose.connection;
  const host = conn.host ?? "(unknown host)";
  const db = conn.name ?? "(unknown db)";
  const prodHost = (process.env.PRODUCTION_DB_HOST ?? "").trim();
  const isProduction = !!prodHost && host.includes(prodHost);

  const line = "-".repeat(64);
  console.log(line);
  console.log(`  script   : ${scriptName}`);
  console.log(`  cluster  : ${host}`);
  console.log(`  database : ${db}`);
  if (isProduction) {
    console.log("");
    console.log("  *** THIS IS THE PRODUCTION DATABASE ***");
    console.log("  Real patient records. Take `npm run backup:raw` before writing.");
  } else if (!prodHost) {
    console.log("  (PRODUCTION_DB_HOST is not set in .env, so this cannot tell you");
    console.log("   whether the cluster above is production -- see README)");
  }
  console.log(line);
  console.log("");
  return { isProduction, host };
}

/**
 * For scripts whose effect cannot be undone by re-running them. Refuses on the
 * production database unless the caller passed --confirm, so a destructive
 * script cannot run against real records by reflex.
 */
export function requireConfirmOnProduction(scriptName: string, confirmed: boolean): void {
  const { isProduction } = announceTarget(scriptName);
  if (isProduction && !confirmed) {
    console.error(`${scriptName} refuses to run against production without --confirm.`);
    process.exit(1);
  }
}
