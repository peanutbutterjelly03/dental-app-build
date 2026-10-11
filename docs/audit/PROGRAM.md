# Audit program — scoped into sprints (151+)

## Context

Floral is feature-complete for Phase 1+2 and deployed, with ~150 sprints behind it. What has
never happened is a systematic pass over the code as a *system*: the security surface, the
architecture map, and the classes of defect that only show up across files (races, stale reads,
edge cases). The user wants that work done, but **divided so no single sprint runs out of
context mid-task**.

Measured surface (2026-09-11):

| Area | Size | Notes |
|---|---|---|
| `server/` + `api/` | 6,254 lines TS | 20 models, `routes/index.ts` 1006, `crudFactory.ts` 439, `schoolScope.ts` 203, `authController.ts` 336 |
| `src/` | 23,981 lines TS/TSX | 41 components, 20 hooks (1,698 lines), offline layer 405 lines, api client 406 |
| `ml-service/` | 1,604 lines Python | FastAPI + 5 algorithms |
| Big components | `DentalChart.tsx` 3088 · `PatientList.tsx` 1790 · `Dashboard.tsx` 1527 · `Reports.tsx` 1325 · `Appointments.tsx` 1174 | |

Two facts drive the design:

1. **There is no test framework.** CI (`.github/workflows/ci.yml`) runs `tsc` on both configs plus
   `npm run build` — nothing else. Verification is ~60 ad-hoc `verify_sprint*.mjs` Puppeteer
   scripts that log into a live server. Multi-file refactoring today has no regression net.
2. **`docs/ARCHITECTURE.md` is stale** — its own header says "derived by reading the actual source
   on 2026-08-08", which predates sprints ~103–150 (multi-school users, server-side scope
   enforcement, referrals, the DOH form surfaces). You cannot audit against a map that no longer
   describes the system, so re-deriving it is sprint one, not an afterthought.

**Decisions taken (user, this session):** security/architecture track first · audit sprints are
**read-only**, fixes are separate approved sprints · add **Vitest for pure logic only** before any
refactor · output is **internal hardening** (terse ledger, no manuscript formatting).

---

## The two rules that keep each sprint small

### Rule 1 — the ledger protocol

Audit sprints write findings, never code. Findings go to two append-only ledgers with stable IDs,
so a later fix sprint can start cold from **one ledger row plus the named file** and never
re-derive the analysis.

- `docs/audit/LEDGER-sec.md` — architecture + security (`SEC-nn`, `ARCH-nn`)
- `docs/audit/LEDGER-bug.md` — debugging track (`BUG-nn`)

Fixed row format, terse by design:

```
### SEC-07 · server/routes/crudFactory.ts:142 · HIGH · OPEN
Claim:    one line, falsifiable
Evidence: file:line, or the exact command and its output
Impact:   one line — what an attacker or a user actually gets
Fix:      one line, or "needs scoping"
```

Status is one of `OPEN` · `FIXED (Sprint N)` · `WONTFIX (reason)` · `NOT-A-BUG (reason)`.
Severity `HIGH` / `MED` / `LOW`. Nothing is deleted from a ledger — status changes instead.

### Rule 2 — the read budget

Per audit sprint, the *entire* allowed read set is:

- `CLAUDE.md` (injected anyway)
- the relevant ledger
- **the file list declared at the top of that sprint, and nothing else**

Plus these standing constraints:

- **Never read `HANDOFF.md` wholesale — it is 296 KB / 1,284 lines.** Read only what is needed by
  line range: `## Live warnings` at 1225 and `## Durable gotchas` at 1254 (`sed -n '1225,1290p'`).
  This one rule is the single largest context saving available.
- **Files over ~800 lines are read in sections**, located by `grep -n` for the symbol, never
  opened wholesale. That covers the five big components and `routes/index.ts`.
- **Anything found outside the declared file list becomes a finding, not an expansion of scope.**
  The sprint does not follow it.
- **If a sprint approaches its budget:** write the findings so far, mark the surface `PARTIAL` in
  the ledger *with the exact stopping point* (file + line + what was not yet examined), end the
  sprint. A follow-up resumes from that line. A truncated-but-recorded audit is useful; a
  context-exhausted one is not.
- One commit per sprint: `Sprint N: <surface> audit — M findings`.

---

## Track A — Architecture & security (read-only)

### Sprint 151 · Architecture map re-derivation + trust boundaries
**Files:** `server/app.ts` · `server/local.ts` · `api/index.ts` · `server/routes/index.ts` (route
table only — `grep -n "router\.\(get\|post\|put\|patch\|delete\)"`) · `server/routes/crudFactory.ts` ·
`server/middleware/auth.ts` · `server/models/index.ts` · `src/app/api/client.ts` ·
`src/app/api/types.ts` · `vercel.json` · `docs/ARCHITECTURE.md`
**Writes:** refreshed `docs/ARCHITECTURE.md`; new `docs/audit/trust-boundaries.md`; ledger created.
**Output:** where each trust boundary sits (browser ↔ Vercel API ↔ Atlas ↔ Render ML), what
crosses it, and what is authenticated at each hop. This is the baseline every later sprint
references instead of re-deriving.
**Seed the ledger with what is already known** rather than rediscovering it:
- `SEC-00` — this PC's `.env` points at the **production** database and there is no dev database on
  the machine (HANDOFF, 10th session). Every script and local dev run hits live patient data.
- `SEC-01` — branch-protection bypass "Repository admin — Always allow" is active on `main`.
- `SEC-02` — real patient PII (Appendix E, a filled Target Client List, ~20 minors) is committed in
  `docs/Group404 - Manuscript.md` and is in git history; repo must stay private.

### Sprint 152 · Auth & session surface
**Files:** `server/controllers/authController.ts` (336) · `server/middleware/auth.ts` ·
`server/utils/jwt.ts` · `server/utils/password.ts` · `server/utils/secretGuard.ts` ·
`server/utils/mailer.ts` · `server/app.ts` (helmet / cors / rate-limit config) ·
`src/app/api/client.ts` · `src/app/offline/authCache.ts` · `src/app/components/Login.tsx`
**Looking for:** token storage and lifetime, refresh handling, the 2FA and password-reset flows,
rate-limit coverage on the endpoints that need it, lockout behaviour, whether any error path leaks
a stack trace or distinguishes "no such user" from "wrong password", CORS/origin allowlist,
`authCache` holding anything sensitive in IndexedDB.

### Sprint 153 · RBAC & multi-school tenancy — **the highest-consequence sprint**
**Files:** `server/routes/crudFactory.ts` (439) · `server/utils/schoolScope.ts` (203) ·
`server/middleware/roleGroups.ts` · `server/controllers/userController.ts` (181)
**Output:** a **role × model × verb matrix** written into the ledger — for each of the 5 roles and
each of the 20 models, what the server actually permits, read off the code rather than intent.
**Looking for:** any list/read path where `school_ids` scoping is absent or bypassable; any route
where the role check is client-side only; whether a School Administrator or BHO Staff can reach
clinical records; IDOR on `:id` routes (does fetching by id re-check scope?); whether archived
records leak to non-admins. One miss here exposes ~8,000 student records across schools.

### Sprint 154 · Route-by-route input validation & authz
**Files:** `server/routes/index.ts` (1006) · `server/routes/authRoutes.ts` ·
`server/utils/asyncHandler.ts` · `server/utils/auditLog.ts`
**Method:** enumerate routes with `grep -n`, then read in blocks of ~200 lines, recording findings
per block. **This sprint is expected to split** — if it does, it ends at a stated line and Sprint
154b resumes there. Plan for two.
**Looking for:** hand-written routes that skip `crudFactory`'s guards; missing or inconsistent
input validation (no zod/joi/express-validator is installed — validation is Mongoose-level or
hand-rolled, so this is a real gap to characterise); mass-assignment via spread of `req.body`;
unbounded reads; routes that mutate without writing an audit-trail entry.

### Sprint 155 · Data layer
**Files:** `server/models/*.ts` (all 20, 705 lines total — small enough to read fully) ·
`docs/DATA-MODEL.md` · the encryption config
**Looking for:** every model carries `isArchived`/`archivedAt`/`archivedBy` and every GET filters
on it; the encrypted-field set matches CLAUDE.md's list exactly (no drift either way); no encrypted
field appears in `filterableText` (random IVs ⇒ silent empty results); index coverage versus the
actual query shapes; `audittrails` unbounded growth; any `.lean()` on a read that must decrypt.

### Sprint 156 · Client-side & supply chain
**Files:** `src/app/api/client.ts` · `src/sw.ts` · `src/app/offline/db.ts` · `vite.config.ts` ·
`index.html` · `package.json` + `npm audit` output · `grep -rn "dangerouslySetInnerHTML\|innerHTML\|eval("` across `src/`
**Looking for:** what the service worker caches and whether any authenticated response lands in a
shared cache; secrets or internal URLs baked into the bundle; XSS sinks, especially in the OCR and
report-rendering paths; dependency advisories; whether the dynamic-import exclusions
(`exceljs`/`jspdf`/`html2canvas`/`tesseract`/`pdfjs`) still hold after recent sprints.

### Sprint 157 · ML service boundary
**Files:** `server/routes/predictionRoutes.ts` (86) · `ml-service/main.py` ·
`ml-service/predictor.py` · `ml-service/pipeline/*`
**Looking for:** is the Render endpoint authenticated or open to the internet; what patient fields
cross the boundary (CLAUDE.md requires names never leave MongoDB); input validation on the FastAPI
side; what happens to a request when the free tier is asleep (the documented 30–60 s cold start and
one-off 503) and whether the UI degrades honestly rather than showing a fabricated risk.

### Then: SEC fix sprints
Grouped by severity and blast radius, **1–3 findings each**, each separately approved. Ordering is
decided after Sprint 153, since that sprint's matrix usually determines what is urgent. A fix
sprint reads only: the ledger rows it is fixing, the files they name, and nothing else.

---

## Track B — Deep debugging

### Sprint 158 · Vitest harness + characterization tests
**Adds:** `vitest` as a dev dependency (near-zero config — the project is already Vite-based),
a `test` npm script, and a `test` step in `.github/workflows/ci.yml`.
**Tests only pure functions**, no components, no database:
`src/app/utils/bmi.ts` (380) · `computeDMFT` (`DentalChart.tsx:94`) · `tallyIptrServices` ·
`server/utils/schoolScope.ts` · `src/app/utils/iptrCheckboxes.ts` (284) ·
`src/app/utils/studentDuplicates.ts`
These are **characterization** tests — they lock in current behaviour so a refactor that changes it
fails loudly. Where a test documents behaviour that looks wrong, that becomes a `BUG-nn` ledger
row, **not** an edit in this sprint.
**This sprint gates Sprint 162.** Without it, decomposing a 3,088-line component is unverifiable.

### Sprint 159 · Offline & sync races
**Files:** `src/app/offline/db.ts` · `queueProcessor.ts` · `queueEvents.ts` · `authCache.ts` ·
`src/sw.ts` · `src/app/hooks/useOfflineQueue.ts` (405 + 43 lines — comfortably one sprint)
**Looking for:** FIFO ordering actually enforced and the queue genuinely stopping on failure rather
than skipping (CLAUDE.md rule); double-submit when connectivity flaps; queue processing racing a
token refresh; what happens to a queued write whose record was archived server-side meanwhile; the
documented iOS ~7-day storage eviction and whether the user is warned.

### Sprint 160 · Data-fetch hooks
**Files:** all 20 of `src/app/hooks/*` (1,698 lines)
**Looking for:** refetch loops from unstable dependencies (HANDOFF already documents this class for
`useAppointments`'s required date window — confirm the others); stale closures; missing abort on
unmount; unbounded reads; two hooks writing the same state. Read hooks in two passes of ~10 to keep
well inside budget.

### Sprint 161 · Report arithmetic edge cases
**Files:** `useDohReportData.ts` · `useFhsisData.ts` · `useSchoolSummary.ts` · `useRPCTracking.ts` ·
`useRiskClassification.ts` · plus the tally helpers they call
**Looking for:** the edge cases behind figures that get **filed with the City Health Office** —
age-at-examination across a school-year boundary, pupils in multiple school years, division by zero
on an empty cohort, the documented "1st/2nd application inferred from chart dates" interpretation,
and any cell that silently prints 0 where the honest answer is *not recorded*.

### Sprint 162 · `DentalChart.tsx` decomposition — the multi-file refactor
**Prerequisites:** Sprint 158 green, and `BUG-nn` for the known live bug already recorded.
**Seed the bug ledger from HANDOFF backlog #63 rather than rediscovering it:** the Dental Chart page
shows only the *first* charting of a school year and hides the rest (`useDentalChartData:85`,
`myCharts.find(...)`); measured on dev 2026-09-05, **22 of 26 IPTRs have more than one chart**.
**Method:** extract by seam, one commit per extraction, `tsc` both configs + `npm run build` after
each. Candidate seams — the odontogram grid, the DMF/dmf summary, the legend/code tables, the PDF
export path, the per-tooth editor. **No behaviour change in this sprint**; the `myCharts.find` fix
is its own follow-up so that a regression is attributable to one or the other, never both.

---

## Verification

- **Every audit sprint:** ends with new numbered rows in the ledger, each carrying a `file:line` or a
  reproducible command in its Evidence line. A finding without evidence does not go in. Working tree
  otherwise clean — `git status` should show only the ledger and, in Sprint 151, `ARCHITECTURE.md`.
- **Sprint 153 specifically:** spot-check three matrix cells live before committing — log in as
  School Administrator and attempt a clinical read; as a single-school user attempt a cross-school
  list; as a non-admin attempt an archived-record read. Use the existing `verify_*.mjs` login
  pattern (wait on `a[href="/patients"]`, never `'nav, aside'`), passwords from `.env`.
- **Sprint 158:** `npm test` green locally and in CI; deliberately break one pure function and
  confirm a test fails.
- **Every fix sprint:** `npx tsc --noEmit` **and** `npx tsc -p tsconfig.server.json --noEmit` and
  `npm run build`, plus `npm test` once 158 lands; then the ledger row flips to `FIXED (Sprint N)`
  in the same commit.
- **Sprint 162:** `npm test` green plus a browser pass over the chart screen at all three device
  widths (390 / 768 / 1280) before the commit.

## Sequencing note

Sprints 151 → 157 run first, then SEC fixes, then 158 → 162. Track B may be pulled forward at any
point if a Track A finding turns out to be a live bug that is cheaper to fix than to carry.

## Not in scope here

Backlog items 57–64 in HANDOFF (design adoption, the visit/charting link, the IPTR form rebuild,
bulk upload) are feature work and stay on their own approval track — an audit sprint that wanders
into them is exactly the scope creep Rule 2 exists to prevent. The OWASP Top 10 write-up and the
ZAP scan remain on the before-defense checklist; because the chosen output is internal hardening,
they are **derived from the finished `LEDGER-sec.md` in a single later sprint**, not formatted into
every sprint along the way.
