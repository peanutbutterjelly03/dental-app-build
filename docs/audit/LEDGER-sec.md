# LEDGER — security & architecture

Append-only. Stable IDs. **Nothing is deleted — status changes instead.**

Status: `OPEN` · `FIXED (Sprint N)` · `WONTFIX (reason)` · `NOT-A-BUG (reason)`
Severity: `HIGH` · `MED` · `LOW`

A row without an Evidence line (a `file:line`, or a command and its output) does not belong here.

**Audit sprints do not fix.** A fix is its own approved sprint, which flips the status in the same
commit as the change.

| Sprint | Surface | Status |
|---|---|---|
| 151 | Architecture map + trust boundaries | DONE — 3 seeded, 11 new |
| 152 | Auth & session | DONE — 7 new; SEC-04 corrected, SEC-07 closed, SEC-08 confirmed, SEC-10 raised |
| 153 | RBAC & multi-school tenancy | DONE — 4 new + the matrix; SEC-04's open question answered. ⚠ live spot-check NOT run (SEC-00) |
| 153a | **FIX** — SEC-18 | DONE — code fixed, tsc + build clean. ⚠ `npm run audit:user-schools` not yet run |
| 154 | Route-by-route input + authz | DONE — 4 new + 1 arch note. **No 154b needed** |
| 155 | Data layer | DONE — **SEC-05 + SEC-06 CLOSED as NOT-A-BUG**; 1 new + 2 doc-drift rows |
| 156 | Client-side & supply chain | DONE — 3 new; SEC-08 mechanism confirmed, SEC-11 reinforced |
| 157 | ML boundary | DONE — 3 new. ⚠ SEC-30 needs one look at the Render dashboard |
| 157a | **FIX** — doc drift (SEC-26, ARCH-02/06/07, half of SEC-28) | DONE — tsc ×2 clean |
| — | **TRACK A COMPLETE** | 31 findings · 3 closed · 5 fixed · 2 HIGH rows blocked on SEC-00 |

---

## Seeded from HANDOFF (known before the audit began — recorded, not rediscovered)

### SEC-00 · this machine's `dental-4-12-main/project/.env` · HIGH · OPEN
Claim:    This PC's `.env` points at the PRODUCTION database, and no dev database exists on it.
Evidence: HANDOFF.md, 10th session resume note (2026-09-07), "THE FINDING THAT OUTRANKS THE REST".
Impact:   Every seeder, migration and local `dev:server` run touches live patient data by default.
          `PRODUCTION_DB_HOST` was unset here too, so both halves of the Sprint 126 safety net were
          off on the one machine that needed them. The label was fixed; the separation was not.
Fix:      Copy the whole dev `.env` from the laptop — never one line, the `FIELD_ENCRYPTION_SECRET`s
          differ. User action, not a sprint.

### SEC-01 · GitHub ruleset `protect-main` · LOW · OPEN (**re-verified 2026-09-11 against the API**)
Claim:    Branch-protection bypass "Repository admin — Always allow" is active on `main`.
Evidence: **Confirmed unchanged**, this time from the API rather than the UI —
          `gh api repos/jirachi13/dental-app-build/rulesets/20584321`:
          `bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }]`
          (role 5 is Admin). `enforcement: "active"`, targeting `~DEFAULT_BRANCH`, last updated
          2026-09-02 — the date HANDOFF records, so nothing has moved since.
          **Every other claim HANDOFF makes about this ruleset also checks out:** `deletion` and
          `non_fast_forward` rules present; `pull_request` with `required_approving_review_count: 1`,
          `dismiss_stale_reviews_on_push: true`, `require_code_owner_review: true`;
          `required_status_checks` naming context **`build`** with
          `strict_required_status_checks_policy: true`. `.github/CODEOWNERS` exists (1.9 KB,
          catch-all `* @jirachi13`), so the code-owner rule is **not** inert.
          One setting HANDOFF does not mention: `require_extra_approval_for_unattributed_changes: true`.
Impact:   Unchanged — the ruleset constrains collaborators, not the owner. Deliberate.
          ⚠ **Immediately relevant:** the 21 unpushed commits will go straight to `main` **because of
          this bypass**. Remove it first and that push is refused, and the work needs a PR.
Fix:      Remove the bypass entry to make the discipline apply to the owner too. User decision —
          and, given the backlog, one better made **after** the current work is pushed.
Note:     This was the last row seeded rather than derived. **All three seeded SEC rows have now been
          re-verified this session** (SEC-00 and SEC-02 earlier), which closes the staleness gap that
          BUG-00 and BUG-01 exposed.

### SEC-02 · `docs/Group404 - Manuscript.md` · HIGH · WONTFIX (accepted, repo stays private)
Claim:    Real patient PII is committed and is in git history — Appendix E (`[image16]`) is a FILLED
          Target Client List: ~20 handwritten names, addresses, birthdates, sex, consultation dates
          of minors. Appendix F carries the dentist's signature.
Evidence: HANDOFF.md `## Live warnings`; acknowledged and deferred by the user 2026-09-02.
Impact:   The repo cannot be made public by a redaction commit — the blob stays in history. Going
          public would need `git filter-repo` + force-push.
Fix:      None while private. Re-open if publication is ever considered. The 2026-08-08 "secret
          audit, clean" note does NOT cover this — that scan looked for credentials, and image data
          inside a markdown file is invisible to it. Both statements are true about different things.

---

## Sprint 151 — architecture map & trust boundaries

### ARCH-01 · `server/routes/index.ts` vs `server/routes/crudFactory.ts` · HIGH · OPEN
Claim:    **There are two read surfaces with different guarantees.** 20 models are mounted through
          `createCrudRouter`, which enforces role, school scope, archive visibility and per-role
          redaction in one place. Alongside it sit **12 hand-written `GET /stats/*` routes** that
          re-implement their own reads and are bound only by `requireAuth`.
Evidence: `server/routes/index.ts` — CRUD mounts at 53, 69–71, 892, 934–941, 946, 959–960, 971, 991,
          1004; `/stats/*` at 95, 100, 155, 331, 391, 426, 464, 537, 620, 671, 760, 792.
          Not one of the twelve passes `requireRole`.
Impact:   This is the architectural root of SEC-03 and SEC-04. Every guarantee the factory makes has
          to be re-made by hand twelve times, and a new `/stats` route inherits nothing. The
          factory's own comment states the principle it breaks — "Hiding the screens is not enough;
          the API is the door" (`crudFactory.ts`, `redact` docblock).
Fix:      needs scoping — Sprint 154 enumerates, then a fix sprint decides between per-route guards
          and a shared `statsRoute()` wrapper carrying role + scope + redaction.

### SEC-03 · `server/routes/index.ts:846` (+ :362, :492, :566) · HIGH · OPEN
Claim:    **Four `/stats/*` routes return pupil names to any authenticated caller, including
          `school_admin`, while `GET /api/students` redacts exactly those fields for that role.**
Evidence: `index.ts:921–926` redacts `full_name, first_name, last_name, middle_name, address,
          contact_number, guardian_name, guardian_contact, philhealth_number, fourps_id,
          place_of_birth, guardian_occupation` for `roles: ["school_admin"]`.
          `index.ts:846` (`/stats/student-rows`) emits `name:` built from `s.last_name`/`s.first_name`
          with no role check and no redaction; same at `:362` (`/stats/reports-panels`), `:492`
          (`/stats/rpc-rows`), `:566` (`/stats/risk-candidates`). All four are `requireAuth` only.
Impact:   A School Administrator — a role CLAUDE.md limits to "school reports + dashboards only, no
          clinical records" — can retrieve identified pupil rows for their school by calling the
          stats endpoint directly. This is the same hole Sprint 101 closed on `/students`, still
          open on the parallel surface.
Fix:      needs scoping. Apply the same redaction (or a role gate) on the four routes.
⚠ Not yet confirmed against a live server. Sprint 153's spot-check must log in as `school_admin`
  and call `/api/stats/student-rows` before this is treated as proven rather than read off the code.

### SEC-04 · `server/models/User.ts:14` + `server/utils/schoolScope.ts:137` · HIGH · OPEN
⚠ **CLAIM CORRECTED IN SPRINT 152.** Originally written as "scoping fails OPEN", implying a bug and
a file at odds with itself. `User.ts` shows the semantic is **deliberate and documented**. The
finding survives the correction; its cause does not.

Claim:    **"All schools" and "assigned to nothing" are the same value, so there is no way to express
          the second.** An empty `school_ids` is the intentional sentinel for global access.
Evidence: `User.ts:14` (Sprint 100), verbatim: "**EMPTY ARRAY MEANS ALL SCHOOLS**: that keeps
          system_admin and bho_staff working exactly as the old `school_id: null` did, with one rule
          instead of a per-role special case."
          Consumed at `schoolScope.ts:137` `return ids.length === 0 ? null : ids;` → `:155`
          `if (!schools) return null;` → `crudFactory.ts` `model.find(scope ? { $and: [...] } : filter)`.
Impact:   Unchanged, and it is the reason the row stays HIGH. A `school_admin` whose assignments are
          cleared — by an edit that removes the last school, a create that never set one, or a
          migration — becomes a **global** reader of all ~8,000 pupils rather than a reader of
          nothing. The role that most needs scoping is the one the sentinel silently promotes.
          Note the same file fails CLOSED for an unknown model (`:161`, "must not silently become
          world-readable"). Models are protected against omission; users are not.
Fix:      needs scoping — separate the two meanings, e.g. name the globally-scoped roles explicitly
          rather than inferring them from an empty array. ⚠ Any fix must keep `system_admin` and
          `bho_staff` global, which is what the sentinel is carrying today.
**Open question ANSWERED by Sprint 153** — yes, and routinely: SEC-18 showed every account created
through the API took the empty default. **That instance is fixed (Sprint 153a); this row stays OPEN
because the design issue is not.** An admin who creates a `school_admin` and selects no school still
gets an unscoped account, since the two meanings remain one value and nothing rejects the empty case.
That guard was deliberately left out of 153a to keep the fix to the bug it was approved for.

### SEC-05 · `server/routes/crudFactory.ts` archive + restore · MED · NOT-A-BUG (the hook is a no-op here)
**Settled in Sprint 155, by reading the plugin rather than reasoning from the rule.**
Evidence: `node_modules/mongoose-field-encryption/lib/mongoose-field-encryption.js` — `updateHook`
          loops over the encrypted fields and does work only inside
          `if (!encryptedFieldValue && plainTextValue) { … }`, where
          `plainTextValue = this._update.$set[field] || this._update[field]`.
          Archive sets `{ isArchived, archivedAt, archivedBy }` and restore sets those three back;
          **none of them is an encrypted field on any model**, so `plainTextValue` is `undefined` for
          every iteration, every branch is skipped, and the hook falls through to `next()` having
          changed nothing.
Verdict:  `findByIdAndUpdate` cannot corrupt an encrypted field through a write that does not contain
          one. Archive and restore are safe as written. **No fix, and none should be made** — see
          ARCH-06 for what this does *not* settle.

### SEC-05 (original claim) · MED
Claim:    Archive and restore use `findByIdAndUpdate` on every model, including the encrypted ones,
          which this codebase forbids everywhere else.
Evidence: `crudFactory.ts` archive and restore handlers both call `model.findByIdAndUpdate(...)`.
          The PUT handler on the same file carries the reason not to: "the latter's
          `pre('findOneAndUpdate')` hook in mongoose-field-encryption has a bug that corrupts
          encrypted fields and crashes on the next decrypt (calls a removed Node crypto API)".
          HANDOFF `## Durable gotchas` states the rule as absolute: "CRUD uses `findById`+`.save()`,
          never `findByIdAndUpdate`".
Impact:   If the plugin's hook fires regardless of which fields the update touches, archiving a
          STUDENT could corrupt its encrypted fields — an unrecoverable data fault reached through a
          routine action.
Fix:      **Verify before fixing.** Sprint 155 must establish empirically whether the hook fires when
          the `$set` contains no encrypted field. If it does not fire, this becomes NOT-A-BUG with
          the reason recorded. Do not "fix" it on the strength of the rule alone.

### SEC-06 · `server/routes/crudFactory.ts` archive + restore responses · MED · NOT-A-BUG (init decrypts)
**Settled in Sprint 155.** The asymmetry is correct, not an oversight.
Evidence: The plugin registers `schema.post("init", …)`, which calls `decryptFields` on every
          document mongoose hydrates from database data. `findByIdAndUpdate(…, { new: true })`
          returns a hydrated document, so `post('init')` runs and the encrypted fields are already
          plaintext by the time the handler sees them.
          `decryptForResponse` exists for the *other* case: after `create()` or `save()`, the
          in-memory document was encrypted in place by `pre('save')` and no `init` ever runs — which
          is exactly why POST and PUT call it and archive/restore do not.
Verdict:  No ciphertext reaches the client on archive or restore. No fix needed.

### SEC-06 (original claim) · MED
Claim:    Archive and restore answer `res.json(doc)` without `decryptForResponse(doc)`, unlike POST
          and PUT which both apply it.
Evidence: `crudFactory.ts` — POST `res.status(201).json(decryptForResponse(doc))`, PUT
          `res.json(decryptForResponse(doc))`, archive/restore `res.json(doc)`.
Impact:   Either ciphertext reaches the client on archive/restore of an encrypted model, or the
          `new: true` document was hydrated through `post('init')` and decryption already happened.
          Which one decides whether this is a bug or dead weight.
Fix:      Verify in Sprint 155 alongside SEC-05 — one test archives a STUDENT and reads the response
          body.

### SEC-07 · `server/app.ts` CORS + cookie auth · LOW · NOT-A-BUG (SameSite=Lax closes the browser vector)
Claim (as written in 151): cookie auth with no CSRF token may allow forged state-changing requests.
Resolved: **Sprint 152 read the cookie flags. The vector is closed.**
Evidence: `authController.ts` `baseCookieOptions` = `{ httpOnly: true, secure: isProd, sameSite:
          "lax" }`, applied to both `access_token` and `refresh_token` at issue, at refresh, and at
          `clearCookie` on logout.
Why it holds: `SameSite=Lax` withholds the cookie from cross-site `POST`/`PUT`/`PATCH`, which is the
          entire CSRF vector here — every state change in this API is one of those verbs. Lax does
          send the cookie on top-level cross-site **GET** navigations, and that is harmless because
          no GET in this API mutates anything. `httpOnly` also keeps the token away from any XSS
          that does get a foothold.
No action. Recorded so a later sprint does not re-raise it. ⚠ Re-open if any state-changing `GET` is
ever added, or if `sameSite` is ever loosened to `"none"`.

### SEC-08 · `src/app/api/client.ts:96-104` + `src/sw.ts` · MED · OPEN
Claim:    Decrypted patient records persist in the browser's Cache Storage after logout.
Evidence: `client.ts` `captureBaselineSnapshot` opens `caches.open('api-cache')` and reads whole
          `/api/*` responses, described in its own comment as populated by "the service worker's
          NetworkFirst `/api/*` caching".
          **CONFIRMED in Sprint 152** — `AuthContext.tsx:259-268`, the whole logout path: `POST
          /auth/logout`, `setUser(null)`, `clearUserCache()`, `clearSessionHint()`,
          `setSelectedSchoolState(null)`. **No `caches.delete('api-cache')`.** In 151 this was
          inference from the absence of evidence; it is now read off the logout function itself.
          Distinct from `authCache.ts`, which logout DOES clear — that one holds staff identity
          (id, name, email, role, schools), not patient data.
          **MECHANISM CONFIRMED in Sprint 156**, `src/sw.ts`: one Workbox route,
          `({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/')` with
          `new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 4 })`. **No exclusion of
          any kind** — so `/api/students`, `/api/medical-histories`, `/api/treatments`,
          `/api/stats/student-rows` and `/api/auth/me` are all cached in full, decrypted.
Fix (refined): logout should `caches.delete('api-cache')`. ⚠ It must run AFTER any pending queue
          drain, because `captureBaselineSnapshot` reads that cache for conflict detection — see
          SEC-27, which is the same problem in the other store.
Impact:   On a shared clinic PC, pupil names, addresses, guardian contacts and PhilHealth numbers —
          the fields encrypted at rest in Atlas — sit in plaintext in the browser profile, readable
          by the next user of that machine. Encryption at rest is undone at the edge.
Fix:      needs scoping — Sprint 156 confirms what the SW actually caches and whether logout should
          call `caches.delete('api-cache')`. ⚠ It must not break the offline queue's baseline
          snapshots, which depend on that cache.

### SEC-09 · `server/app.ts` error handler · LOW · OPEN
Claim:    Mongoose `ValidationError` and `CastError` messages are returned verbatim to the client.
Evidence: `app.ts` — `if (err.name === "ValidationError" || err.name === "CastError") { res.status(400)
          .json({ error: err.message }); }`.
Impact:   Leaks schema field names, enum values and model names. No stack trace (that rule is
          honoured — `console.error(err)` is server-side only and the 500 body is generic), so this
          is disclosure, not exposure.
Fix:      Map to a generic 400 message, or allowlist the messages safe to surface.

### SEC-10 · `server/routes/authRoutes.ts:32` · MED · OPEN
⚠ **SEVERITY RAISED IN SPRINT 152 (was LOW).** Reading the controller showed the unlimited route
that matters is not `/auth/refresh` — it is `/auth/change-password`, and the file argues against
itself about it.

Claim:    **`PATCH /auth/change-password` verifies the current password and is not rate-limited**,
          which is precisely the oracle `/auth/verify-password` was rate-limited to prevent.
Evidence: `authRoutes.ts:32` — `router.patch("/change-password", requireAuth, ...)`, no
          `makeAuthLimiter()`. `authController.changePassword` calls `comparePassword(currentPassword,
          user.password_hash)` and answers 401 "Current password is incorrect" on a miss.
          Two lines below, `:35` `verify-password` **is** limited, with the reason in the comment:
          "an unlimited yes/no on a password is an oracle" — and `verifyPassword` does the same
          `comparePassword` and returns the same yes/no.
Impact:   Anyone holding a live session (a borrowed unlocked clinic PC, a stolen cookie) can brute-
          force the account's current password at unlimited rate, then change it. The step-up route
          built to prevent exactly this sits beside it, guarded.
Also unlimited, and deliberate enough to leave: `:29 /refresh` (requires a valid refresh cookie;
          mints nothing without one) and `:30 /logout` (clears cookies, no secret checked).
Fix:      Add `makeAuthLimiter()` to `:32`. One line, but it is a fix sprint, not this one.

### SEC-11 · `dental-4-12-main/project/index.html` · LOW · OPEN
Claim:    The SPA's HTML is served as a Vercel static asset and carries no Content-Security-Policy;
          helmet only covers responses Express generates.
Evidence: `app.ts` comment — "This server only ever returns JSON (the React app is served
          separately)". `vercel.json` rewrites `/((?!api/).*)` to `/index.html`, which never passes
          through Express.
Impact:   The document that runs all the JavaScript has no CSP, no `X-Frame-Options`, no
          `Referrer-Policy`. Helmet protects the surface that needs it least.
Fix:      Add a `headers` block to `vercel.json` for the static routes. ⚠ A CSP must be checked
          against the dynamic-import chunks (exceljs / jspdf / html2canvas / tesseract / pdfjs) and
          the service worker before it is turned on.

### ARCH-02 · `server/middleware/auth.ts:21` · LOW · FIXED (Sprint 157a)
**Fixed 2026-09-11.** The comment now says scoping **is** enforced and points at `schoolScope.ts`,
notes that it previously said the opposite, and adds the empty-array-means-all-schools warning with
a pointer to SEC-04 — so the spot a reader checks to learn whether scoping is on now tells them both
true things. `tsc` clean on both configs.

Original finding follows.
Claim:    A comment states the opposite of what the code now does: "school_ids is carried but NOT yet
          enforced on any query — Sprint 101."
Evidence: `auth.ts:21`, against `schoolScope.ts` (Sprint 101 shipped the enforcement) and its 11 call
          sites in `routes/index.ts`.
Impact:   Documentation-as-code failure at the exact spot a reader checks to learn whether scoping is
          enforced. It reads as authoritative and is wrong.
Fix:      One-line comment change. Bundle into the first fix sprint that touches this file.

### ARCH-03 · `docs/ARCHITECTURE.md` · — · FIXED (Sprint 151)
Claim:    The architecture map was stale on six counts, having been derived 2026-08-08.
Evidence: Documented `PATCH /:id` for update where the factory registers `PUT /:id`; listed four
          `CrudOptions` where twelve exist; described school scoping nowhere; listed one `/stats`
          route where twelve exist; omitted `/day-notes` and `/referrals`; said "the 16 ERD models"
          where `models/index.ts` exports 19; described the `findByIdAndUpdate` failure as "the write
          lands as plaintext" where the real mode is corruption plus a crash on next decrypt.
Impact:   Every later audit sprint would have been measured against a map that no longer described
          the system.
Fix:      Re-derived this sprint. `docs/ARCHITECTURE.md` now carries a §2.5 on school scoping, the
          full options table, the complete `/stats` surface, and a dated verification line.

---

## Sprint 152 — auth & session

**Read:** `authController.ts` · `jwt.ts` · `password.ts` · `authRoutes.ts` · `secretGuard.ts` ·
`mailer.ts` · `authCache.ts` · `Login.tsx` · `User.ts` (41 lines, outside the declared list — read
deliberately, because `/auth/me` and `login` both return a whole User document and the claim
"nothing sensitive leaks" could not be made honestly without it).

**Rows this sprint changed:** SEC-04 claim corrected · SEC-07 closed · SEC-08 upgraded from
inference to confirmed · SEC-10 severity raised and re-aimed.

### What is correct here, recorded so no later sprint re-derives it
- JWT algorithm **pinned to HS256** on both sign and verify (`jwt.ts`), the standard algorithm-
  confusion mitigation. Separate secrets for access and refresh.
- **bcrypt, 12 rounds** (`password.ts`).
- OTP from `randomInt` and reset token from `randomBytes(32)` — both CSPRNG. **Only SHA-256 hashes
  are stored**, never the code or token. `password_hash`, `otp_hash`, `reset_token_hash` are all
  `select: false` on the schema, so the full-document responses from `/auth/me` and `login` cannot
  carry them.
- OTP is **single-use** — cleared before the session is issued, not after.
- `forgotPassword` always answers the same generic 200, so it cannot be used to probe which emails
  have accounts. Resend cooldowns on both OTP and reset (60 s) stop mail flooding.
- `refresh` **re-reads the user from the database** instead of trusting the token's embedded role and
  `school_ids`, so a role change, a school reassignment or an archive propagates within 15 minutes
  rather than persisting for the refresh token's 7 days.
- Login answers a generic "Invalid credentials" for both an unknown email and a wrong password.
- `Login.tsx` keeps the password in component state only and hands autofill to the browser
  (`autoComplete="username"` / current-password), with a comment explaining that storing a password
  anywhere itself would be "a waiting to happen".

### SEC-12 · `server/controllers/authController.ts` logout / changePassword / resetPassword · MED · OPEN
Claim:    **There is no way to revoke a session.** Logout clears cookies only; changing or resetting
          a password does not invalidate tokens already issued.
Evidence: `authController.logout` is three lines — `clearCookie("access_token")`,
          `clearCookie("refresh_token")`, `res.json({ ok: true })`. No denylist, and `User.ts` has no
          `token_version` / `sessions_valid_from` field for `refresh` to check against.
          `changePassword` and `resetPassword` both write `user.password_hash` and save; neither
          touches any token state.
Impact:   A refresh token copied before logout stays valid for its **full 7 days**. And the ordinary
          remedy for a suspected compromise — change the password — **does not evict the attacker**.
          Concretely: HANDOFF records that all five demo passwords were rotated and applied to the
          live database in Sprint 75. Any session live at that moment survived the rotation.
          Mitigated in practice by the default: without "Remember me" both cookies are session
          cookies, so closing the browser on a shared clinic PC does end that session.
Fix:      needs scoping — the small version is a `sessions_valid_from` timestamp on User, set by
          logout / change / reset, checked in `refresh` against the token's `iat`. ⚠ That bounds
          exposure to the 15-minute access-token life, not to zero; a true kill switch needs the
          access token checked too, which costs a DB read per request.

### SEC-13 · `server/controllers/authController.ts` forgotPassword · MED · OPEN
Claim:    **The password-reset link's host is taken from a request header.** Whether that is
          exploitable currently depends on a control added for a different purpose.
Evidence: `forgotPassword` — `const origin = typeof req.headers.origin === "string" &&
          req.headers.origin ? req.headers.origin : process.env.APP_URL ?? "https://dental-app-
          build.vercel.app";` then `resetEmailHtml(`${origin}/reset-password?token=${token}`)`.
Impact:   **Not exploitable as configured, and that is the finding.** A forged `Origin: https://
          evil.com` is rejected at 403 by the CORS allowlist in `app.ts` before the controller runs,
          so the classic reset-poisoning takeover does not land today. That makes **CORS load-bearing
          for reset-link integrity**, which is not what it was added for and is not written down
          anywhere. `app.ts` records that this CORS block used to be `origin: true`; restoring
          anything like it — or adding a wildcard entry to `ALLOWED_ORIGINS` — converts this into
          full account takeover, and nothing in the reset code would change to signal it.
          Lesser, live today: an allowlisted-but-useless origin (`http://localhost:5173`) can be sent
          by a non-browser client, mailing a real user a reset link that goes nowhere.
Fix:      Build the link from `process.env.APP_URL` unconditionally and drop the header entirely.
          The header buys nothing — production is same-origin.

### SEC-14 · `server/controllers/authController.ts` login · MED · OPEN
Claim:    Login leaks which email addresses have accounts, by timing.
Evidence: `login` returns 401 immediately when `User.findOne` misses. Only a **found** user reaches
          `comparePassword`, which is bcrypt at 12 rounds (`password.ts`) — tens to hundreds of
          milliseconds. The response bodies are correctly identical; the response times are not.
Impact:   An unauthenticated caller can enumerate staff accounts. Small population (~10 users) and
          the addresses are institutional and guessable, so this is reconnaissance, not a breach —
          but it undoes the generic-message work already done deliberately in the same function.
          `verifyOtp` has the same shape, far less pronounced (SHA-256 is cheap next to bcrypt).
Fix:      Compare against a dummy hash when the user is not found, so both paths pay the same cost.

### SEC-15 · `server/routes/authRoutes.ts` + `server/models/User.ts` · MED · OPEN
Claim:    **Rate limiting is per-IP only and there is no per-account lockout**, which cuts both ways.
Evidence: `makeAuthLimiter()` passes no `keyGenerator`, so `express-rate-limit` keys on IP: 10
          attempts / 15 min. `User.ts` has no failed-attempt counter or lock field.
Impact:   (a) **Availability** — a clinic's staff share one NAT address, so ten bad logins from one
          site lock out *everyone* there for 15 minutes. The `authRoutes` comment anticipated this
          for the cross-route case and split the limiters; the within-route case remains.
          (b) **Security** — an attacker spread across IPs faces no per-account ceiling at all.
          (c) **OTP** — `verifyOtp` neither counts attempts nor clears the code on a wrong guess, so
          a 6-digit code stays guessable for its whole 10-minute life, bounded only by per-IP limits.
Fix:      needs scoping — a per-account attempt counter is the piece that is missing; keying the
          limiter on email as well as IP is the cheaper half.

### SEC-16 · `server/utils/mailer.ts` otpEmailHtml · LOW · OPEN
Claim:    The 2FA code is in the email **subject line**.
Evidence: ``subject: `${code} is your FLORAL login code` ``.
Impact:   Lock-screen notification previews show subjects, so the second factor is readable on a
          locked phone — which is much of what the second factor was for. Common industry practice,
          so this is a tradeoff to make deliberately rather than a defect.
Fix:      Move the code into the body only. One line; needs a decision, not scoping.

### SEC-17 · `server/controllers/authController.ts` refresh · LOW · OPEN
Claim:    The refresh token is never rotated and reuse is not detected.
Evidence: `refresh` re-issues only `access_token`; the original `refresh_token` stands for its full
          7 days.
Impact:   Compounds SEC-12 — a captured refresh token is usable for a week and its use is
          indistinguishable from the real user's. Fix SEC-12 first; this is the follow-on.

### ARCH-04 · `server/utils/secretGuard.ts` · LOW · OPEN (already backlog #49)
Claim:    Startup secret checking **warns and never throws**, including when `JWT_ACCESS_SECRET` is
          missing or still an `.env.example` placeholder.
Evidence: `checkStartupSecrets` — `console.warn` on every branch, returns the offending names.
Impact:   Deliberate, and the docblock gives the reason: it runs on Vercel's serverless boot, where a
          hard exit would take the live site down rather than degrade. Recorded so a later sprint
          does not "discover" it as an oversight.
Fix:      Tighten to a refusal once the deployed values are confirmed real — already tracked as
          backlog #49.

---

## Sprint 153 — RBAC & multi-school tenancy

**Read:** `userController.ts` · the CRUD mount block (`routes/index.ts:53-71`, `:873-1006`) ·
`crudFactory.ts`, `schoolScope.ts`, `roleGroups.ts` (already in context from 151) · two narrow greps
into `AccountManagement.tsx` to establish what the UI actually sends on create.

⚠ **The live spot-check the program calls for was NOT run — see the note at the end of this
section.** Everything below is read off the code.

### The matrix — what the server actually permits

Derived from the mount options plus `crudFactory`'s defaults (`readRoles` = `ALL_ROLES`,
`writeRoles`/`archiveRoles`/`restoreRoles` = `ADMIN_ONLY`). `clinical` = system_admin + dentist +
dental_aide. **Bold = departs from the default.**

| Model | read | create / update | archive | restore | scoped via | redacted |
|---|---|---|---|---|---|---|
| School | all 5 | admin | admin | admin | none | — |
| User | **admin** | admin | admin | admin | none | — |
| Dentist | all 5 | admin | admin | admin | school_id | — |
| DentalAide | all 5 | admin | admin | admin | school_id | — |
| Student | all 5 | clinical | admin | admin | school_id | **school_admin: 12 fields** |
| StudentIptr | all 5 | clinical | **admin + dentist** | admin | student_id | — |
| MedicalHistory | all 5 | clinical | admin | admin | iptr_id | — |
| DietarySocialHabits | all 5 | clinical | admin | admin | iptr_id | — |
| OralHealthCondition | all 5 | clinical | admin | admin | iptr_id | — |
| DentalChart | all 5 | clinical | admin | admin | iptr_id | — |
| ToothRecord | all 5 | clinical | admin | admin | chart_id | — |
| Treatment | all 5 | clinical | admin | admin | iptr_id | — |
| PreventiveCareRecord | all 5 | clinical | admin | admin | iptr_id | — |
| RiskStratification | all 5 | clinical | admin | admin | preventive_id | — |
| Appointment | all 5 | clinical | admin | admin | student_id | — |
| DentistRotation | all 5 | clinical | admin | admin | school_id | — |
| DayNote | all 5 | clinical | **clinical** | admin | school_id_or_global | — |
| Referral | all 5 | clinical | admin | admin | iptr_id | — |
| AuditTrail | **admin** | **read-only** | — | — | none | — |

**What this shows is consistent and deliberate:** archive and restore are admin-only almost
everywhere, the two deviations each carry a written reason, `AuditTrail` is admin-read and
unwritable through the API, and writes are properly split clinical-vs-admin. The problem is not the
write column. **It is that the read column is `all 5` on thirteen clinical models.**

### SEC-18 · `server/controllers/userController.ts:11,33` · HIGH · FIXED (Sprint 153a)
**Fixed 2026-09-11.** `createUser` now destructures `school_ids` and passes it to `User.create()`,
with an explicit array-of-ObjectIds check so a malformed value fails cleanly instead of casting to a
single-element array or surfacing as a schema-revealing CastError (SEC-09). The dead
`school_id: school_id || null` write is gone. `npx tsc` on both configs and `npm run build` clean.
Verified no other site had the same bug: the only remaining `school_id:` writes are on `Dentist` and
`DentalAide`, which legitimately carry that field, and `seedDemo` already passes `school_ids`
explicitly through `ensureUser`.

⚠ **The code is fixed; the DATA is not yet checked.** `npm run audit:user-schools`
(`server/scripts/auditUserSchools.ts`, new, read-only) reports every account holding an empty
`school_ids`, separating the roles that are unscoped by design (`system_admin`, `bho_staff`) from
`school_admin`, where it is a real grant, and leaving dentist/aide under REVIEW rather than judging
for you. **It has not been run** — this machine points at production and the run was refused by the
sandbox. Run it on the laptop's dev database, and on production when convenient; any account it lists
under the first heading is fixed by editing it in Account Management, since the edit path writes
`school_ids` correctly and always did.

Original finding follows.

### SEC-18 (original) · `server/controllers/userController.ts:11,33` · HIGH
Claim:    **`createUser` writes a field the User schema does not have, so every account created
          through the API gets `school_ids: []` — which means ALL SCHOOLS.** The admin's school
          selection is silently discarded.
Evidence: `userController.ts:11` destructures `school_id` (singular); `:33` writes
          `school_id: school_id || null`. **`User.ts` has no `school_id` path** — it has
          `school_ids: { type: [ObjectId], default: [] }` (Sprint 100 renamed it). Mongoose strict
          mode drops the unknown key, so the write is a no-op and `school_ids` takes its default.
          `school_ids` is **never read by the controller at all.**
          The UI does send the right thing: `AccountManagement.tsx:98` holds
          `school_ids: [] as string[]`, `:385` binds the school picker to it, `:204` posts the whole
          `form` to `/users`. The server ignores it.
          Confirmed there is no compensating mapping: `grep "school_id\b"` excluding `school_ids`
          returns only these two lines plus Student's own legitimate `school_id`; no `pre('save')`
          hook exists on `User.ts` or `models/shared/`.
Impact:   **A School Administrator created and assigned to one school is created with access to all
          three.** This is not an edge case — it is the outcome of every account creation. It is also
          the concrete answer to SEC-04's open question: an empty `school_ids` is not merely
          reachable, it is the default state of every new user.
          Masked in practice because editing a user afterwards goes through `crudFactory`'s PUT,
          where `school_ids` **is** a schema field and does save. So an admin who creates and then
          edits ends up correct, and one who only creates does not.
Fix:      Read `school_ids` in `createUser` and pass it to `User.create()`. Small, but it is a fix
          sprint. ⚠ **A fix must also audit existing accounts** — every user created since Sprint 100
          may be carrying `[]` unintentionally, and the ones to check first are the `school_admin`
          and any scoped role.

### SEC-19 · `server/routes/index.ts:876` · HIGH · OPEN
Claim:    **Thirteen clinical models are readable, unredacted, by `school_admin` and `bho_staff`** —
          the two roles CLAUDE.md defines as non-clinical.
Evidence: Every clinical mount omits `readRoles`, so it takes `crudFactory`'s `ALL_ROLES` default:
          `medical-histories`, `dietary-social-habits`, `oral-health-conditions`, `dental-charts`,
          `tooth-records`, `treatments`, `preventive-care-records`, `risk-stratifications`,
          `appointments`, `referrals`, `day-notes`, `student-iptrs`, `dentist-rotations`.
          Only `Student` carries a `redact` block; none of the thirteen does.
          The grant is deliberate and explained at `:876`: "Clinical models — all 5 roles can read
          (school_admin/bho_staff need this for dashboards/reports per CLAUDE.md's own role
          descriptions)".
Impact:   `GET /api/medical-histories?iptr_id=X` returns allergies and the hypertension / diabetes /
          hepatitis / blood-disorder flags. `GET /api/treatments?iptr_id=X` returns `diagnosis` and
          `treatment_done`. **Both models hold AES-256 encrypted fields — encrypted precisely because
          they are sensitive — and the API decrypts them on the way out for a role CLAUDE.md says
          gets "no clinical records".**
          The justification cites CLAUDE.md while contradicting its own clause for that role.
⚠ **Before fixing, establish whether the grant is still load-bearing.** It was written when
          dashboards read raw collections. Sprint 151 found twelve `/stats/*` aggregate routes that
          now serve exactly those screens. If the school_admin and bho_staff dashboards are on
          `/stats`, this grant is dead weight and can simply be narrowed; if any screen still reads a
          raw clinical collection, narrowing it breaks that screen. **That check is the first task of
          the fix sprint** — grep the hooks those two roles' screens use. Do not narrow blind.

### SEC-20 · `server/routes/index.ts:921-926` · MED · OPEN
Claim:    The student redaction names `school_admin` only, so **`bho_staff` reads full pupil identity
          across every school.**
Evidence: `redact: { roles: ["school_admin"], fields: [...12 identity fields...] }`. `bho_staff` is
          absent from that list, and is one of the roles `User.ts:14` leaves unscoped (empty
          `school_ids` = all schools), so the reach is all three sites.
Impact:   Names, addresses, contact numbers, guardian names and contacts, PhilHealth and 4Ps ids for
          all ~8,000 pupils. CLAUDE.md gives Barangay Health Office Staff "consolidated reports
          across all schools, City Health Office report submission" — consolidated figures, which
          need no identified rows.
Fix:      Add `bho_staff` to the `redact.roles` list, subject to the same "is it load-bearing?" check
          as SEC-19. One word, once that check passes.

### SEC-21 · `server/controllers/userController.ts` createUser · LOW · OPEN
Claim:    Creating a user with an email that already exists answers **500**, not a clean 409.
Evidence: `createUser` performs no uniqueness check; `User.ts` has `email: { unique: true }`, so the
          collision surfaces as a Mongo duplicate-key error. `app.ts`'s handler special-cases only
          `ValidationError` and `CastError`, so this falls through to the generic 500.
Impact:   Cosmetic but misleading — the admin is told the server broke when in fact the input was
          rejected. Compare `crudFactory`'s `uniqueBy`, which answers a proper 409.
Fix:      Check first, or map duplicate-key (code 11000) to 409 in the error handler.

### SEC-13 — second instance found
`userController.sendResetLink` builds its reset link from `req.headers.origin` with exactly the same
fallback as `authController.forgotPassword`. **Both call sites must change together**; fixing one
would leave the admin-initiated path exposed to the same coupling.

### SEC-04 — open question ANSWERED
"Can a `school_admin` actually reach an empty `school_ids`?" **Yes — every newly created one has it,
by default.** See SEC-18. SEC-04 stays open as the design issue (two meanings, one value); SEC-18 is
the concrete instance and is the one to fix first.

### ⚠ The live spot-check was not run, and why
The program's verification step for this sprint is to log in as `school_admin` and confirm SEC-03 and
SEC-19 against a running server. **This machine's `.env` points at the PRODUCTION database and there
is no dev database on it (SEC-00).** Probing live patient records with a low-privilege account to
prove an access-control finding is not something to do casually, and SEC-00 is unresolved.

**So both HIGH read-access findings (SEC-03, SEC-19) remain read-off-the-code, not demonstrated.**
They should be confirmed on the laptop's dev database, or after a dev `.env` reaches this PC, before
any fix sprint acts on them. SEC-18 needs no live check — the schema mismatch is decisive on its own.

---

## Sprint 154 — route-by-route input validation & authz

**Read:** `routes/index.ts` (the ~890 lines not covered by 151/153) · `asyncHandler.ts` ·
`auditLog.ts` · `healthController.ts`.

**It did not need to split.** The program predicted a 154b. The file turned out to be far more
uniform than its length suggests — 12 `/stats` routes sharing one shape, and input handling that is
identical in all 32 places — so targeted reads plus pattern counts answered the sprint's questions
without reading every aggregation line. No 154b is needed.

### What is correct here, recorded so no later sprint re-derives it
- **Only `/health` is unauthenticated**, and it returns `{ status, db }` — a connection-state word,
  no version, no host, no connection string.
- **All twelve `/stats/*` routes are GET.** The parallel surface of ARCH-01 can read but **cannot
  write**, which bounds that finding materially.
- All six mutating routes outside `crudFactory` are `requireAuth` + `requireRole(...ADMIN_ONLY)`.
- **Every one of the 32 `req.query` reads is guarded by `typeof … === "string"`.** That defeats
  Express's query-object injection — `?school[$ne]=x` arrives as an object, fails the guard, and
  never reaches `School.findOne`. This is the best thing in the file and it is done consistently,
  not sporadically.
- `/stats/risk-history` validates the ObjectId **and** re-applies the school scope before returning
  one pupil's history — the by-id path, done right.
- `asyncHandler` wraps every async route, so a rejected promise reaches the error handler rather
  than hanging the request.

### SEC-22 · `server/routes/index.ts:180` · MED · OPEN
Claim:    **`/stats/notifications` returns an unscoped `appointmentsToday`** — the one number of the
          three that ignores both the caller's schools and the school switcher.
Evidence: `Appointment.countDocuments({ isArchived: false, appointment_datetime: { $gte: dayStart,
          $lt: dayEnd } })` — no scope clause, no `school_id`. The other two counts in the same
          handler both filter through `scopedIptrIds`, and the comment beside `awaitingValidation`
          states the rule being broken: "A risk row whose preventive record is outside the selected
          school must not be counted; without the scope check the badge would ignore the school
          switcher entirely."
Impact:   A user scoped to one school sees a bell count that includes every school's appointments.
          Counts only — no patient data crosses — so this is a correctness and trust failure rather
          than a disclosure: the switcher changes two of three numbers and silently not the third.
          CLAUDE.md: a control that appears to work must work.
Fix:      Scope the count the way the other two are scoped. Contained to one handler.

### SEC-23 · `server/routes/index.ts` — 11 sites · MED · OPEN (latent, **not** live)
Claim:    **The security clause is merged two different ways, and the safe idiom is the minority.**
Evidence: `{ isArchived: false, ...scope }` at :333, :393, :428, :466, :539, :631, :673, :762, :796
          (nine). `{ $and: [studentFilter, scope] }` at :114 and :169 (two).
Impact:   **Correct today — do not "fix" it as a live bug.** The two `$and` sites are exactly the
          routes whose base filter carries a `school_id` from `?school`, which is where a spread
          would let the caller's choice overwrite the permission clause. The nine spread sites have
          no colliding key, so they are safe as written.
          The finding is that the rule exists only inside two comments, while the fragile idiom is
          what a new route is most likely to copy — nine examples against two. A future `/stats`
          route that spreads *and* filters by school silently reinstates the Sprint 101 bug, and
          nothing would fail.
Fix:      Make one idiom the only idiom — a small helper that merges with `$and` unconditionally, so
          the safe form is also the easy form.

### SEC-24 · `server/routes/index.ts` — 37 sites · MED · OPEN
Claim:    The `/stats` routes read whole collections, unbounded, and nothing rate-limits them.
Evidence: 37 `.find(active)` calls with no `limit`. `/stats/reports-panels` alone reads students,
          schools, IPTRs, charts, tooth records, treatments and referrals **in full** on every
          request. `express-rate-limit` is applied only in `authRoutes.ts`.
Impact:   At the Chapter 1 scale (~8,000 pupils) this is the largest class of read in the app, and
          any authenticated user can trigger it as fast as they can issue requests. This is the same
          scale risk HANDOFF already names for `audittrails`, on a surface that runs on every
          dashboard load.
          ⚠ **Partly deliberate** — the comments explain that three consumers aggregate over the
          whole population, so paging the *data* would break them. The finding is the absence of any
          ceiling at all, not the design choice.
Fix:      needs scoping. A rate limiter on `/stats` is the cheap half and does not touch the joins.

### SEC-25 · `server/routes/index.ts:530-531, 611` · LOW · OPEN
Claim:    `limit` has no upper bound.
Evidence: `limit: Number(req.query.limit) > 0 ? Number(req.query.limit) : 25`. `?limit=1000000000`
          passes; so does `?limit=1e400`, which becomes `Infinity`.
Impact:   Small, because the database read is already the whole collection (SEC-24) and the limit is
          applied afterwards in JS — so this affects response size only, not query cost. Note the
          guard *is* safe against non-numeric input: an array or object gives `NaN`, and `NaN > 0`
          is false, so it falls back to 25.
Fix:      Clamp to a maximum alongside the existing floor.

### ARCH-05 · `server/utils/auditLog.ts` · LOW · OPEN (deliberate, recorded)
Claim:    A failed audit write is swallowed, so a mutation can succeed unaudited.
Evidence: `logAudit` wraps `AuditTrail.create` in try/catch and only `console.error`s on failure —
          "Fire-and-forget: an audit logging failure should never break the actual user-facing
          operation it's logging."
Impact:   CLAUDE.md requires the audit trail to log ALL user actions. The tradeoff chosen — lose an
          audit row rather than fail a clinical write — is defensible and probably right for this
          app, but it means the trail cannot be claimed to be complete. Worth knowing before anyone
          describes it as complete in Chapter 4.
Fix:      None proposed. Recorded so the claim made about it stays accurate.

---

## Sprint 155 — data layer

**Read:** all 19 model files + `models/shared/*` (705 lines, read in full) ·
`node_modules/mongoose-field-encryption/lib/mongoose-field-encryption.js` (the hooks and
`updateHook`, ~110 lines) · CLAUDE.md's DATA ENCRYPTION section.

**This sprint CLOSED two rows rather than adding to the pile: SEC-05 and SEC-06 are both
NOT-A-BUG**, each settled by reading the plugin instead of reasoning from the codebase's own rule.

### What is correct here, recorded so no later sprint re-derives it
- **Every `.lean()` read of an encrypted model projects only unencrypted fields.** All ten sites
  checked: `.select("_id")`, `Treatment…select("iptr_id date")`, `Student…select("_id school_id sex
  birthday")`, `Referral…select("iptr_id referral_type")`. This is the trap HANDOFF warns about
  hardest — lean skips `post('init')`, so a lean read of an encrypted field returns ciphertext with
  a 200 and no error — and it is clean everywhere.
- **No encrypted field appears in any `filterableText`.** Student's is `["grade_level", "section"]`;
  every other model filters on ObjectIds only. Random IVs would make such a filter silently return
  nothing rather than fail.
- **Soft delete on 18 of 19 models.** The exception is `AuditTrail`, and it is correct — an audit
  trail that can be archived is not an audit trail (see ARCH-07 for the doc mismatch).
- `Student`'s `pre('save')` is registered **before** the encryption plugin, so `full_name` is rebuilt
  from the name parts while they are still plaintext and only then encrypted. Registering it after
  would write a plaintext `full_name` over the encrypted one. Subtle, and right.
- `fieldEncryptionOptions` passes `secret` as a **function**, so a missing `FIELD_ENCRYPTION_SECRET`
  throws where it is used rather than at import time.
- **Random IV per value confirmed at source**: no `saltGenerator` is passed, so the library defaults
  to a fresh `crypto.randomBytes(16)` per encryption, and `decrypt` reads the IV back out of the
  stored `<iv>:<ciphertext>` value rather than from config — which is why removing the old constant
  IV stayed backward-compatible.
- **Indexes: 13 of 19 models declare one.** The six without are `School`, `User`, `Dentist`,
  `DentalAide`, `DentistRotation` and `RiskStratification` — all either tiny collections or never
  queried by field (`RiskStratification` is read whole-collection by the `/stats` joins, which an
  index would not help). Checked, not a finding.

### SEC-26 · `CLAUDE.md` DATA ENCRYPTION section · LOW · FIXED (Sprint 157a)
**Fixed 2026-09-11.** CLAUDE.md now names five models, carries Student's twelve fields, and states
explicitly that this list is what the `filterableText` rule is checked against — so the next reader
is told why the list has to stay exact, not just what it contains.

Original finding follows.
Claim:    **CLAUDE.md's encrypted-field list is stale on two counts**, and it is the document the
          project treats as authoritative for exactly this question.
Evidence: CLAUDE.md names four models. The code encrypts **five**:
          `Referral.ts:66` — `fieldEncryptionOptions(["reason", "notes"])`, added Sprint 127, never
          added to CLAUDE.md.
          And Student carries **twelve** fields, not the ten listed: `Student.ts:87` adds
          `place_of_birth` and `guardian_occupation` (Sprint 174).
Impact:   No live violation today — `filterableText` names no encrypted field, and every `.lean()`
          projection avoids them. The risk is procedural: the "never put an encrypted field in
          `filterableText`" rule is enforced by a human consulting this list, and the list is wrong
          about two Student fields and an entire model. Someone adding `?place_of_birth=` as a text
          filter, or filtering referrals by `reason`, would get a filter that silently matches
          nothing — the failure mode CLAUDE.md itself calls out as worse than a loud one.
Fix:      Update the list in CLAUDE.md. ⚠ Doc-only, but it is a CLAUDE.md edit, so it belongs to a
          sprint the user approves rather than being slipped into an audit commit.

### ARCH-06 · `docs/ARCHITECTURE.md` §5 + HANDOFF durable gotchas · LOW · FIXED (Sprint 157a)
**Fixed 2026-09-11, in all three places** (CLAUDE.md, `ARCHITECTURE.md` §5, HANDOFF durable
gotchas). Each now states the rule as a **convention**, records that its reason has been wrong
twice, and says plainly that the real mechanism has not been re-derived so none should be cited.
Each also carries SEC-05's verified archive/restore exception, so the rule and its one legitimate
violation travel together instead of looking like a contradiction.

Original finding follows.
Claim:    **The stated REASON for the "never `findByIdAndUpdate` on encrypted models" rule does not
          match this configuration.** The rule may still be right; its recorded mechanism is not.
Evidence: Both docs say the plugin's hook "calls a removed Node crypto API". That API is
          `crypto.createCipher`, and the plugin reaches it only via `encryptAes256Ctr`, selected by
          `options.useAes256Ctr` — which defaults to `false` (plugin source `:88`) and is **not set**
          anywhere in `shared/fieldEncryption.ts`. The active strategy is `encrypt`, which uses
          `crypto.createCipheriv` (`:25`), an API that is present and working.
Impact:   Sprint 151 corrected this line once already (from "the write lands as plaintext" to
          "corruption plus a crash"); this sprint shows the replacement is also not the mechanism.
          **Keep the rule** — `findById` + `.save()` is the right default and SEC-05's exception is
          narrow. But nobody should cite the reason until it is re-derived, and a fix sprint that
          "fixed" something on the strength of it would be acting on a wrong model of the bug.
Fix:      Either re-derive the real failure mode from the plugin, or restate the rule as a convention
          without a mechanism it cannot support.

### ARCH-07 · `CLAUDE.md` SOFT DELETE RULES · LOW · FIXED (Sprint 157a)
**Fixed 2026-09-11.** "ALL models include…" → "All models include… **except AUDIT_TRAIL,
deliberately**", with the reason and a note that the absolute wording is what invited someone to
"fix" the model to match.

Original finding follows.
Claim:    CLAUDE.md states "**ALL** models include: isArchived … archivedAt … archivedBy". One model
          correctly does not.
Evidence: `AuditTrail.ts` has no `softDeleteFields`; `crudFactory`'s mount comment says so
          explicitly — "AuditTrail has no isArchived, so the date range is the only filter."
Impact:   The code is right and the rule is absolute. A reader reconciling the two could "fix" the
          model to match the rule, which would make audit entries archivable — the opposite of what
          an audit trail is for.
Fix:      Note the exception in CLAUDE.md. Same handling as SEC-26: a CLAUDE.md edit is its own
          approved change.

---

## Sprint 156 — client-side & supply chain

**Read:** `src/sw.ts` · `src/app/offline/db.ts` · `vite.config.ts` · `index.html` ·
`package.json` + `npm audit --omit=dev` · an XSS-sink sweep of all of `src/` · the built
`dist/assets/` and `dist/sw.js` precache manifest.

### What is correct here, recorded so no later sprint re-derives it
- **Zero XSS sinks in the entire frontend.** `grep` for `dangerouslySetInnerHTML`, `innerHTML`,
  `eval(`, `new Function` and `document.write` across `src/` returns **nothing**. React's escaping is
  intact end to end — including the OCR and report-rendering paths, which were the ones worth
  worrying about.
- **No secrets reach the bundle.** There is no `import.meta.env` usage anywhere in `src/`, and a grep
  of the built `dist/assets/` for connection strings, JWT/Brevo/encryption key names and API-key
  patterns finds nothing. Nothing server-side leaks client-side.
- The service worker **never caches or replays writes** — only `GET` is routed, and the comment
  states the reason: the app's own IndexedDB queue is the single source of truth, not Workbox's.
- **No unconditional `skipWaiting()`.** Activation waits for the user to click Refresh on the update
  toast, so open tabs are not silently swapped onto stale assets.
- **The precache exclusions do hold for the big two.** `tesseract` and `pdfjs` are both bundled
  inside `iptrOcr-*.js`, which `globIgnores` excludes — so HANDOFF's claim about them is right, just
  by a different route than their own filenames. Verified against the actual manifest in `dist/sw.js`,
  which lists 6 asset entries and none of the excluded chunks.

### SEC-27 · `src/app/offline/db.ts` · MED · FIXED (Sprint 159a)
**Fixed 2026-09-11, with BUG-03 — one cause, one fix.** `enqueueWrite` now stamps `userId` from
`authCache` (written at login, cleared at logout, readable synchronously where there is no React
context to ask). `processQueue` reads the signed-in user once per drain and calls `isOwnedBy`, a pure
rule in `queueRules.ts`:

- **Nobody signed in → send nothing.** Previously this reached the API and was turned back by a 401,
  which was safe but burned a refresh and flagged the row auth-blocked for a user who had not arrived.
- **Another user's row → HELD, never dropped** — it is somebody's unsynced clinical work. `continue`,
  not `break`, for the same reason a conflict does: a row waiting for its owner must not wedge the
  writes of the person actually sitting there.
- **Legacy rows (no `userId`) drain under whoever is signed in**, deliberately — refusing them would
  strand real unsynced work behind an app update, a worse failure than the one being fixed. The
  window is self-limiting: it closes the first time the queue drains.

⚠ **This DEGRADES a graded feature, and it is documented in `sw.ts` rather than left to be
discovered.** Background Sync (Sprint 20 — "the queue drains even if the tab was closed") now **holds
every row instead of sending it**. A service worker can learn who owns a row but **cannot learn whose
session it is about to write under**: the session is an httpOnly cookie it may send but never read,
and `localStorage` does not exist in a worker, so `loadUserCache()` returns null there by design. **A
worker that cannot tell whose session it is writing under must not write.** Queued rows now wait and
the page drains them on next open, as itself. The cost is a later sync; the gain is that it can no
longer sync as the wrong person.

Verified: `npm test` 55/55, `tsc` both configs, `npm run build` — all clean.

Original finding follows.

### SEC-27 (original) · MED
Claim:    **The offline queue is a second plaintext patient-data store, and its records have no
          owner.** There is no way to clear it, and a queued write can be replayed under a different
          user's session than the one that created it.
Evidence: `QueuedWrite` carries `body` (the full write payload), `baselineSnapshot` (the record as
          last seen, read out of `api-cache`) and `conflictServerRecord` (the server's version) —
          all patient data, all plaintext in IndexedDB `floral-offline` / `writeQueue`.
          **The interface has no user id field**, so the queue cannot tell whose write a row is.
          `grep` for `clearQueue`, `deleteDatabase` and `floral-offline` across `src/` returns only
          the declaration in `db.ts` — **no clearing path exists anywhere in the app**, so logout
          cannot clear it even if it wanted to.
Impact:   On a shared clinic PC: aide A captures records offline, logs out; dentist B signs in; the
          queue drains **under B's session**, and `logAudit(req.user!.id, …)` records B as the author
          of A's work. The audit trail then attributes clinical data entry to the wrong person —
          which is the one thing an audit trail exists to get right.
          ⚠ **Clearing the queue on logout would be the WRONG fix** — unsynced field data is exactly
          what must survive a logout. The fix is ownership: stamp the queue row with the user id at
          enqueue, and refuse (or hold) rows belonging to someone else.
Fix:      needs scoping — stamp the queue row with the user id at enqueue, then hold or refuse rows
          belonging to someone else.
**CONFIRMED in Sprint 159, and the trigger is worse than assumed.** `App.tsx:10-12` calls
`initQueueProcessor()` in a root `useEffect(…, [])` **outside `AuthProvider`**, and that function
calls `processQueue()` immediately whenever `navigator.onLine`. The queue drains **on every app
load**, before and regardless of any login check, with `credentials: 'include'`.
 · **Nobody logged in** → 401 → refresh fails → `markAuthRequired`, stop. **Fails safe.**
 · **A different user logged in** → the writes land under *their* session and the audit trail records
   *them*. No unusual timing needed — just the next person to sign in on that clinic PC.
See BUG-03 in `LEDGER-bug.md`: the same trigger also races the service worker's copy of the queue.

### SEC-28 · `package.json` / `npm audit` · LOW · OPEN
Claim:    **`npm audit` has drifted from 0 to 3 moderate**, and HANDOFF still records it as 0.
Evidence: `npm audit --omit=dev` → `qs` 2.2.5–6.15.3, reached via `express@4.22.2` → `body-parser`.
          Two advisories: GHSA-x5fp-wj9c-mxmx (array-limit bypass via bracket-key comma parsing) and
          GHSA-4mjr-xmp4-gh2g (DoS via attacker-controlled `isBuffer`). The only clean fix is
          `express@5.2.1`, a breaking change.
          HANDOFF's durable gotchas say "the uuid override in package.json keeps `npm audit` at 0" —
          true when written, not true now.
Impact:   **The first advisory is largely blunted by work already done.** Sprint 154 established that
          all 32 `req.query` reads are guarded by `typeof … === "string"`, so a bracket-key array
          that slips the qs array limit fails the guard and never reaches a query. The second, a
          parser-level DoS, is **not** blunted by anything the app does.
Status:   **Half-addressed in Sprint 157a** — HANDOFF's stale "npm audit at 0" line is corrected, so
          the next reader is not misled. The advisories themselves stay open **by decision**.
Fix:      ⚠ **Not before the defense.** express 4→5 is a breaking change across every route and
          middleware signature, for two moderate advisories on an internal-use app behind
          authentication. Record it, re-check after. Update the stale HANDOFF line either way.

### SEC-29 · `vite.config.ts` `globIgnores` · LOW · OPEN (payload, not security)
Claim:    Two chunks of the PDF-export feature slip the precache exclusions, because the exclusion
          list matches **filenames** and these two do not carry the family's name.
Evidence: `globIgnores` lists `iptrOcr-*`, `exceljs*`, `jspdf*`, `html2canvas*`. The manifest in
          `dist/sw.js` nonetheless precaches `assets/index.es-DIdGXNez.js` (156 KB — its first line
          is `import{_ as La}from"./jspdf.es.min-…js"`, so it is jspdf-family) and
          `assets/purify.es-Csrj9YNg.js` (27.5 KB — DOMPurify, a jspdf dependency).
Impact:   ~184 KB that every device downloads on service-worker install for a feature most staff
          never use — the same class of waste the comment in that file says was fixed for the
          382 KB jspdf chunk, on the phone-over-mobile-data case CLAUDE.md's three-device rule
          cares about. Not a security issue.
Fix:      Add the two patterns, or better, exclude by what the chunk imports rather than by name.
          ⚠ The file's own warning applies: never exclude a **statically**-imported chunk, or the
          app breaks offline. Both of these are reached only through `import()`.

### SEC-11 — reinforced by this sprint
`index.html` carries no CSP: 12 lines of `<meta>`, a favicon, a title and one module script, with no
`http-equiv` of any kind. Worth noting for the fix — a `<meta http-equiv="Content-Security-Policy">`
in this file is an alternative to Vercel response headers if the headers route proves awkward. The
file is otherwise clean: no inline script, no inline style, no third-party tag.

---

## Sprint 157 — ML boundary (last Track A sprint)

**Read:** `server/routes/predictionRoutes.ts` · `ml-service/main.py` · `ml-service/predictor.py`
(`model_info`, and a sweep for logging) · `.env.example` · the local `.env` key names only.

### What is correct here — and the headline is that CLAUDE.md's privacy rule is ENFORCED, not just intended
- **No patient identity can cross this boundary, by construction.** `predictionRoutes.ts` builds the
  outbound body from a **13-key allowlist** — `for (const k of FEATURE_KEYS) body[k] = features[k]`
  — so a name, address or record id cannot cross **even if the client sends it**. `student_id` is
  accepted by the route but used **only** for the audit log; it is never forwarded. CLAUDE.md
  requires that names never leave MongoDB, and this is the code that makes it true.
- **No feature values are logged.** The only `print` calls in `predictor.py` are in its `__main__`
  demo block, not the request path — so no patient-derived numbers land in Render's logs, which are
  a third-party surface outside the trust boundary.
- Pydantic validates **every one of the 13 features** with an explicit `ge`/`le` range.
- Express side: `requireAuth` + `requireRole("dentist", "system_admin")`, every assessment
  audit-logged against the student it was generated for, **503 when the service is unreachable and
  502 when it rejects** — so the UI degrades honestly rather than fabricating a risk band. Timeouts
  are deliberate (8 s status, 30 s predict for the documented cold start).
- Every response re-states the clinical disclaimer, and `model_info()` carries the `synthetic_data`
  flag that drives the UI's honesty banner. CLAUDE.md's "dentist must validate" rule travels in the
  payload rather than living only in a screen.

### SEC-30 · `ml-service/main.py` `_check_key` · HIGH if unset, else none · **OPEN — NEEDS THE USER**
Claim:    **The ML service authenticates only if a key happens to be configured, and no key is set
          anywhere in the repository.** Whether the deployed service is open cannot be determined
          from here.
Evidence: `main.py` — `def _check_key(request): if API_KEY and request.headers.get("x-api-key") !=
          API_KEY: raise HTTPException(401)`. With `API_KEY = os.environ.get("ML_SERVICE_API_KEY",
          "")` empty, the condition short-circuits and **every request is accepted**. The module
          docstring states it plainly: *"Unset = open, for local dev."*
          Express mirrors the same shape — `...(ML_SERVICE_API_KEY ? { "X-API-Key": … } : {})` sends
          no header when its own value is empty.
          `.env.example:71` has `# ML_SERVICE_API_KEY=` — commented out and empty. This machine's
          `.env` does not define it at all.
          ⚠ **Render's environment is configured in its dashboard, independently of any `.env` in
          this repo, so none of the above proves the deployed service is open.** It proves only that
          nothing in the repo would set it.
Impact:   **If unset on Render**: `POST /predict` at the public URL accepts any caller. This is *not*
          a patient-data disclosure — the request carries only the 13 numbers the caller supplies and
          the response is a risk band for those numbers, so an attacker learns nothing about any
          pupil. It is an **open compute endpoint**: anyone who finds the URL can run the model, and
          there is **no rate limiting anywhere in the FastAPI app**. On the free tier that is a
          plausible way to exhaust the service during defense week — which HANDOFF already flags as
          the moment it most needs to answer.
          The URL is not secret: it appears in HANDOFF and in `.env.example`'s placeholder form.
Fix:      **First, answer the question** — check the Render dashboard for `ML_SERVICE_API_KEY`. If it
          is set, this row closes as NOT-A-BUG with the reason recorded. If it is not, set it on both
          Render and Vercel (the same value) and it closes as fixed.
          ⚠ Separately, consider whether `_check_key` should **fail closed** in production rather
          than treating an empty key as permission — see the pattern note below.

### The fail-open pattern — third instance
`if API_KEY and …` joins **SEC-04** (an empty `school_ids` means *all schools*) and **SEC-13**'s
origin fallback: three places where **an absent or empty value is read as permission** rather than as
a misconfiguration. Each is individually defensible and locally documented; together they are a habit
worth naming, because the failure is always silent and always in the permissive direction. Whatever
is decided about SEC-30 specifically, this is the line to remember from Track A.

### SEC-31 · `ml-service/main.py` `/health` · LOW · OPEN
Claim:    `/health` is unauthenticated by construction, unlike `/predict`.
Evidence: `def health(request: Request)` takes the request but **never calls `_check_key`**;
          `predict` calls it on the first line. `/health` returns `predictor.model_info()` =
          `{algorithm, **_model_meta}` — the algorithm's display name, training metadata, and the
          `synthetic_data` flag.
Impact:   Discloses that the service exists, which algorithm is active and when it was trained. No
          patient data. Reasonable for a health check; worth being a deliberate choice rather than an
          omission, since `predict` beside it is gated.

### SEC-32 · `server/routes/predictionRoutes.ts` · LOW · OPEN
Claim:    Express forwards the ML service's error body verbatim to the browser.
Evidence: `res.status(502).json({ error: "Prediction service rejected the request", detail: result })`.
Impact:   A FastAPI 422 names the offending field and its constraint. Same class as SEC-09, but
          milder: these are ML feature names (`dmf_score`, `calculus`), not patient schema.
Fix:      Log the detail server-side, return a generic message. Bundle with SEC-09.

---

## ▶ TRACK A COMPLETE (Sprints 151–157)

Seven read-only audits, one fix sprint (153a). **31 findings recorded, 3 closed, 1 fixed.**

**Still HIGH and open:** SEC-02 (PII in git history, accepted/WONTFIX) · SEC-00 (this PC points at
production) · SEC-03 and SEC-19 (clinical reads by non-clinical roles — **read off the code, never
demonstrated live, because SEC-00 blocks the check**) · SEC-04 (the empty-value-means-all design) ·
SEC-30 (**conditional — needs one look at the Render dashboard**).

**Two things Track A could not do, both for the same reason:** the live RBAC spot-check (Sprints 153)
and any probe of the deployed ML service. Both need a database and an environment that are not
production. **SEC-00 is therefore not just a finding — it is the blocker on closing two HIGH rows.**

---

### ARCH-01 — bounded by Sprint 154
All twelve `/stats` routes are GET, and eleven of the twelve call `scopeFilter` themselves. So the
unguarded parallel surface is a **read** problem only (SEC-03, SEC-19, SEC-22), never a write one.
The twelfth, `/stats/last-change`, needs no scope — but note it does expose a fact derived from
`AuditTrail` to all five roles, while `AuditTrail`'s own CRUD mount is `readRoles: ADMIN_ONLY`. It
is one timestamp, so the severity is nil; it is a clean small example of the pattern.
