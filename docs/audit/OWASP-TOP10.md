# FLORAL against the OWASP Top 10 (2021)

**Prepared 2026-10-04** for the before-defense checklist (CLAUDE.md, SECURITY: "OWASP Top 10 compliance
before deployment; ZAP scan after deployment"). Built from the security ledger
(`docs/audit/LEDGER-sec.md`, findings SEC-00 to SEC-35 and ARCH-01 to ARCH-07), with **every open
finding re-checked against the code on 2026-10-04**, because several ledger headers had gone stale.

- **Edition:** OWASP Top 10:2021. The manuscript names no edition; 2021 is the stable, widely cited one.
- **Scope:** the React PWA, the Express API on Vercel, MongoDB Atlas, and the FastAPI ML service on
  Render.
- **Method:** a read-only code audit (Sprints 151 to 157), fix sprints, and live API checks on the
  development database. **This is not a penetration test.** The ZAP scan (the other half of the
  checklist item) has **not** been run yet; see "Not done yet" at the end.
- **Status words:** **Addressed** = controls in place and verified; **Partial** = controls in place
  with known open gaps; **Open** = a gap with no control yet.

## Summary

| # | Category | Status | Open items (severity) |
|---|---|---|---|
| A01 | Broken Access Control | **Partial** | testing mode ON (HIGH while on), SEC-04 empty-school sentinel (HIGH), SEC-20 accepted |
| A02 | Cryptographic Failures | **Partial** | secrets exposed 2026-10-01, rotation not confirmed (HIGH); SEC-02 accepted |
| A03 | Injection | **Addressed** | qs advisory (blunted, see A06) |
| A04 | Insecure Design | **Partial** | fail-open pattern (SEC-04, SEC-13); SEC-24 unbounded reads |
| A05 | Security Misconfiguration | **Partial** | no CSP on the app page (SEC-11), error detail (SEC-09, SEC-32), ARCH-04 |
| A06 | Vulnerable and Outdated Components | **Open** | `npm audit`: 6 advisories, 1 high (SEC-28) |
| A07 | Identification and Authentication Failures | **Partial** | SEC-10, SEC-14, SEC-15, SEC-16, SEC-17 |
| A08 | Software and Data Integrity Failures | **Partial** | OCR engine loaded from a CDN unpinned (MED, new); SEC-01 (LOW) |
| A09 | Security Logging and Monitoring Failures | **Partial** | ARCH-05 audit write is best-effort; no alerting |
| A10 | Server-Side Request Forgery | **Addressed** | none |

---

## A01 Broken Access Control — Partial

**In place**
- **Every API route requires sign-in**, and roles are checked on the server for every call:
  `requireAuth` + `requireRole` (`server/middleware/auth.ts`); per-model read, write, archive and
  restore roles in `server/routes/crudFactory.ts`; role groups in `server/middleware/roleGroups.ts`.
- **School scoping is enforced on the server** (`server/utils/schoolScope.ts`, `scopeFilter`): a
  dentist or aide assigned to one school reads only that school's pupils, and an unknown model fails
  closed.
- **Non-clinical roles cannot read clinical records** (Sprint 163: SEC-19, SEC-03, SEC-33 fixed):
  medical history, treatments, dental charts, tooth records, risk results and referrals are readable
  by the clinic roles and the System Admin only. Verified on dev as each role (School Admin gets 403 on
  medical, referral and risk routes).
- **One role table drives both the menu and a page guard** (`utils/routeRoles.ts`, SEC-34 fixed), so a
  hidden screen cannot be opened by typing its URL.
- **Only the dentist can validate a risk result** (SEC-35 fixed, `writeRoles: ["dentist"]`; a System
  Admin attempt returns 403).
- **Archive and restore are System Admin only**, and nothing is ever hard-deleted.
- **CSRF:** auth cookies are `httpOnly`, `Secure` in production and `SameSite=Lax`, and no GET route
  changes data, which closes the cross-site request vector (SEC-07, not a bug).

**Open or decided**
- ⚠ **Testing mode is ON in production** (`OPEN_ACCESS_TESTING=true`, set 2026-10-01 for the
  classmate's testing): `requireRole` lets every signed-in user through. Sign-in is still required.
  **Must be OFF before the defense and any real use** (CLAUDE.md AUTH RULES); check `/api/config` →
  `{"testingMode":false}`.
- **SEC-04 (HIGH, open):** an empty `school_ids` means "all schools", so a School Administrator saved
  with no school becomes a reader of every school instead of none. The creation bug that made this
  common is fixed (SEC-18), but nothing rejects the empty case for a scoped role.
- **SEC-20 (accepted 2026-09-29):** BHO staff see pupil identity across all schools, for the named
  Target Client List and Consent Form.
- **User decision 2026-10-04:** the School Admin sees pupil **names** again (`NAME_BLIND_ROLES`
  emptied). Address, contact numbers, PhilHealth and 4Ps numbers stay hidden from that role. This
  partly reverses SEC-03; the ledger records it.

## A02 Cryptographic Failures — Partial

**In place**
- **Sensitive patient fields are encrypted at rest** with AES-256 (`mongoose-field-encryption`) on
  eight models: STUDENT (12 identity fields), DENTAL_AIDE, MEDICAL_HISTORY, TREATMENT, REFERRAL,
  APPOINTMENT, RISK_STRATIFICATION and SYNC_CONFLICT (list in CLAUDE.md, DATA ENCRYPTION).
- **A fresh random IV per value** (`<iv>:<ciphertext>`, verified at source, Sprint 155), so equal
  values do not produce equal ciphertext.
- **Passwords:** bcrypt, 12 rounds. One-time codes and reset tokens come from a cryptographic random
  source and **only their SHA-256 hashes are stored**; hash fields are excluded from every response.
- **Tokens:** JWT pinned to HS256 on sign and verify, separate access and refresh secrets.
- **Transport:** HTTPS on Vercel and Render.
- **The ML service never receives identity:** the request is built from a fixed list of 13 numeric
  features (`predictionRoutes.ts`), so a name cannot reach it even if a client sends one.

**Open or accepted**
- ⚠ **Secrets exposed 2026-10-01 (HIGH until rotated):** the production database password,
  `FIELD_ENCRYPTION_SECRET`, the JWT secrets (identical in dev and prod) and two API keys were pasted
  into a chat. Rotation is a user action listed in HANDOFF; it is **not confirmed done**. The
  encryption key cannot simply be changed without a planned re-encryption; rotating the database
  password is what protects it meanwhile.
- **SEC-02 (accepted):** a filled paper form with real pupil details is embedded in the manuscript
  file in this private repository's history. Acceptable only while the repository stays private.
- **Offline copies (by design):** for offline work, a decrypted copy of every in-scope pupil is kept in
  the browser's IndexedDB on the device, wiped at sign-out (CLAUDE.md, PWA / OFFLINE). A lost
  unlocked phone holds the roster; a device screen lock is the real control. (The older SEC-08 issue,
  API responses left in the service worker's cache after logout, no longer applies: the service worker
  does not cache `/api` at all, and sign-out clears the offline read cache.)

## A03 Injection — Addressed

- **No raw database queries;** all access is through Mongoose models.
- **Query-string injection is blocked:** every one of the server's `req.query` reads is guarded by
  `typeof … === "string"` (Sprint 154), so an operator object such as `?school[$ne]=x` never reaches a
  query.
- **No XSS sinks in the frontend:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`
  or `document.write` anywhere in `src/` (Sprint 156). React escapes all output, including OCR text
  and report rendering.
- **Input validation:** Mongoose schema validation on every model; shared value checks for names,
  dates and phone numbers (`shared/studentValidation.ts`); the ML service validates all 13 features
  with explicit ranges.
- **One dependency advisory touches this area** (the `qs` array-limit bypass, SEC-28). It is blunted by
  the string guards above: a smuggled array fails the guard and is never queried.

## A04 Insecure Design — Partial

**In place**
- **The dentist validates every risk result before clinical action,** enforced on the server
  (SEC-35), recorded in the audit trail, and stated in every prediction response.
- **The model gives risk only;** treatment suggestions are rules the dentist accepts or skips one by one
  (2026-10-04).
- **Offline writes cannot be replayed as the wrong person:** each queued write is stamped with its
  owner and held for another user (SEC-27 fixed); conflicting offline edits are held for review rather
  than overwriting (SYNC_CONFLICT).
- **Duplicate pupils are caught** at every save and, for bulk uploads, before saving.

**Open**
- **The fail-open pattern** (ledger, end of Track A): in three places an empty value means
  "allowed" instead of "misconfigured": SEC-04 (empty schools = all schools), SEC-13 (the reset link's
  host falls back to the request's `Origin` header; not exploitable today only because CORS rejects
  unknown origins), and the ML key check (set in production, so not exposed: see A07).
- **SEC-24:** the `/stats` routes read whole collections with no rate limit; at ~8,000 pupils any
  signed-in user can trigger the heaviest reads repeatedly.

## A05 Security Misconfiguration — Partial

**In place**
- `helmet()` sets security headers on every API response; CORS is an explicit allowlist
  (`server/app.ts`).
- **No stack traces reach the client;** the generic error handler logs on the server only.
- `.env` files are never committed; secrets live in Vercel and Render settings.
- **Only `/health` is unauthenticated,** and it returns a status word, no version or host.
- **The service worker never caches API responses or replays writes;** updates wait for the user to
  click Refresh (no forced `skipWaiting`).

**Open**
- **SEC-11 (LOW):** the app's HTML page is served as a static file and has no Content-Security-Policy,
  `X-Frame-Options` or `Referrer-Policy`; helmet covers only API responses. Fix: a `headers` block in
  `vercel.json` (checked against the lazily loaded OCR, PDF and Excel chunks first).
- **SEC-09, SEC-32 (LOW):** database validation messages and the ML service's validation detail are
  returned verbatim, revealing field names (no stack traces).
- **ARCH-04 (LOW):** a missing or placeholder secret at startup only logs a warning, by design so the
  live site degrades rather than going down.
- **Production switches to reset before the defense:** testing mode OFF (A01), and
  `SCHOOL_YEAR_DATE_RULES = true`.

## A06 Vulnerable and Outdated Components — Open

`npm audit --omit=dev` on 2026-10-04 reports **6 advisories: 1 high, 4 moderate, 1 low** (up from 3
moderate when SEC-28 was recorded):

| Package | Severity | Issue |
|---|---|---|
| brace-expansion | **high** | CPU denial of service on crafted patterns |
| qs (via express, body-parser) | moderate | array-limit bypass; denial of service via `isBuffer` |
| ip-address | moderate | subnet checks compare different address families |
| dompurify | low | a hook can leave event handlers on removed nodes |

`npm audit` now reports a fix available for each. **Not applied:** a dependency change needs its own
approved sprint, a full test and build, and a re-run of the import audit behind
`docs/technology-documentation.md` (CLAUDE.md, DOC ROLES). Recommended before the defense.

## A07 Identification and Authentication Failures — Partial

**In place**
- **Two-step sign-in:** password, then a one-time code by email; the code is single-use.
- **Rate limits** (10 attempts per 15 minutes per IP) on login, code verification, forgot-password,
  reset and password re-check.
- **Generic answers** that do not reveal whether an email has an account (login and forgot-password).
- **Short-lived access token (15 minutes)**, refresh token 7 days only with "Remember me"; otherwise
  session cookies that end when the browser closes.
- **Sessions can be revoked:** logout, password change and password reset stamp
  `sessions_valid_from`, which every refresh checks (SEC-12 fixed).
- **30-minute idle lock:** the device's session ends and the same account must re-enter its password
  (`SessionLock.tsx`).
- **The ML service requires its key in production:** a request without it was refused with
  401 "invalid API key" on 2026-10-04, which closes SEC-30.

**Open**
- **SEC-10 (MED):** changing your password checks the current one but is **not rate-limited**
  (`server/routes/authRoutes.ts:32`, the only password check without the limiter). One-line fix.
- **SEC-15 (MED):** limits are per IP only, with no per-account lockout. Staff behind one clinic
  network share a limit, and a wrong one-time code does not count against the code itself.
- **SEC-14 (MED):** login takes measurably longer for an existing account (bcrypt runs only then),
  revealing which staff emails exist.
- **SEC-16 (LOW):** the one-time code is in the email subject, visible on lock-screen previews.
- **SEC-17 (LOW):** the refresh token is not rotated on use.
- **SEC-13 (MED, latent):** see A04.

## A08 Software and Data Integrity Failures — Partial

- **Deploys come only from the protected `main` branch** (GitHub ruleset: pull request review, a
  required `build` check, no force-push or deletion). **SEC-01 (LOW):** the repository owner can bypass
  it, by choice.
- **The app itself is built and served by Vercel;** the page loads no third-party script, and the PDF
  reader's worker is bundled with the app (`iptrOcr.ts`, `pdf.worker.min.mjs?url`).
- ⚠ **OCR is the exception (NEW, found 2026-10-04, MED):** `Tesseract.createWorker` is called with no
  `workerPath`, `corePath` or `langPath` (`src/app/utils/iptrOcr.ts:611`), so on each scan Tesseract.js
  downloads its worker script and WebAssembly engine from the jsDelivr CDN, and the English language
  data from a public tessdata host, **with no integrity pinning**. A compromised or changed file there
  would run inside the app with access to the page. Fix: serve those three files from the app itself
  (copy them into `public/` and pass the three paths), which also lets OCR work without reaching a
  third party.
- **The offline queue's integrity rules:** first-in-first-out, stop on failure and never skip; a
  repeated create is applied once (SYNC_OPERATION); edits that would overwrite someone else's change
  are held for review.
- **App updates are user-confirmed** (Refresh prompt), so open tabs are not silently swapped.

## A09 Security Logging and Monitoring Failures — Partial

**In place**
- **The audit trail records every create, edit, archive and restore** through the CRUD layer, plus
  sign-ins, risk assessments and validations, with the acting user, time, model and record.
  It cannot be archived or edited through the API, and only the System Admin can read it.

**Open**
- **ARCH-05 (deliberate):** an audit write that fails is logged on the server but does not block the
  action it describes, so the trail is very nearly but not provably complete. Say so in Chapter 4
  rather than calling it complete.
- **No alerting:** nothing notifies anyone of repeated failed sign-ins or unusual activity; review is
  manual through the Audit Trail screen.

## A10 Server-Side Request Forgery — Addressed

The server makes outbound requests only to fixed addresses taken from its own configuration: the ML
service (`ML_SERVICE_URL`) and the email provider. No route fetches a URL supplied by a user.

---

## Not done yet

1. **ZAP scan of the live site** (the second half of the checklist item). It sends real traffic at the
   production deployment, so it needs the user's go-ahead and a time when testers are not using it.
2. **Live confirmation as the School Admin in a browser** of the Sprint 163 screens (verified through
   the API only).

## Before the defense, in order

1. **Rotate the exposed secrets** (A02) — user action, steps in HANDOFF.
2. **Turn testing mode OFF** and set `SCHOOL_YEAR_DATE_RULES = true` (A01, A05).
3. **Apply the dependency fixes** (A06) in an approved sprint, with tests, build and the technology
   documentation import audit.
4. **Rate-limit `change-password`** (SEC-10): one line.
5. **Decide SEC-04:** require at least one school for a School Administrator.
6. **Run the ZAP scan** and add its results here.
7. **Self-host the OCR engine files** (A08, new): three files into `public/`, three paths in
   `iptrOcr.ts`.
8. Optional, small: CSP headers (SEC-11), dummy-hash login timing (SEC-14), code out of the email
   subject (SEC-16).
