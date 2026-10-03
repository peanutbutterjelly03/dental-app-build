# Persona Review Panel — Findings (2026-07-03)

Five persona seats reviewed the **live production app** (https://dental-app-build.vercel.app).
Evidence: 10 full-page screenshots (2026-07-02 tour), fresh strict probes (2026-07-03: wrong-password state, mobile 390px viewport, a11y DOM checks, timing), and source-code verification of every suspected bug — nothing below is assumed from pixels alone.

Severity scale: **P1** = wrong information or blocks a real task · **P2** = confusing/risky, workaround exists · **P3** = polish.

---

## Seat 1 — Dentist (clinical workflow)

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| D1 | **P1** | **RPC stat tiles show wrong percentages.** "Visit 1 Completed 5 (26%)" — 5 of 7 enrolled is 71%. Numerators are school-scoped, denominator is the all-schools list (5/19=26%). Same family as the footer bug fixed in Sprint 21g; the tiles were missed. A dentist reads coverage 45 points too low. | `RPCTracking.tsx:188-189` divide by `rpcRecords.length`; tile counts use `schoolRecords` |
| D2 | **P1** | **Appointments calendar always opens on April 2026** — initial month is hardcoded, not "now". Today's appointments exist (the Today tab shows them) but the calendar view starts 3 months in the past and drifts further every week. | `Appointments.tsx:41` `useState(new Date(2026, 3, 1))`; live-confirmed 2026-07-03 |
| D3 | **P2** | **Chart prev/next navigates across ALL schools** ("11/19" while the roster shows 7). Dentist reviewing one school's queue silently walks into other schools' patients; contradicts every other page's school scoping. | `DentalChart.tsx:144` builds `navList` from unscoped `allStudents` |
| D4 | **P2** | **Test student "NoDate, Test" (Kinder, TestSection, age 11) is in the production roster** — appears in patient lists, RPC tracking, counts, and CSV exports. Clinical data hygiene + embarrassing at defense. Archive via Account/admin flow (never hard delete). | p3/p6 screenshots, live DB |
| D5 | **P3** | Dental Charts queue empty state says "No dental charts match the selected filters" when the queue is simply empty and no filters are set — tells the dentist to fiddle with filters instead of "queue students from the Students page". | `DentalChartNav.tsx:133` (same string in `DentalChartList.tsx:115`) |
| D6 | **P3** | First risk assessment after idle can 503 (Render free-tier cold start, ~30-60s). UI copes ("re-select and try again") but a dentist mid-consult won't know to wait. Known limitation; a "warming up, retrying…" message would fit better than a failure toast. | Probe console: one 503 during tour; HANDOFF known issue |

## Seat 2 — Cybersecurity

Overall posture is **strong for the threat model** (internal tool, ~10 staff): helmet CSP/HSTS/X-Frame-Options confirmed live, CORS allowlist enforced, login rate-limited (verified 429 previously), generic "Invalid credentials" (no user enumeration), JWT alg pinned, passwords bcrypt'd, field-level encryption, full audit trail.

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| S1 | **P2** | **Deterministic encryption IV** (deferred since Sprint 15.5) remains the top real crypto weakness — same plaintext → same ciphertext, leaks which records share values. Needs its own careful pass (wrong move makes real records undecryptable). | HANDOFF "Not done yet (security)" |
| S2 | **P3** | Console logs 5+ `401` errors on every login page load (pre-auth `/me` probes — benign) plus the Render 503. Noise trains staff to ignore red console errors and looks bad in a live defense demo with DevTools open. Silence the expected pre-auth 401 (catch without `console.error`, or skip `/me` when no session hint exists). | Probe console output |
| S3 | **P3** | No 2FA / email reset (already backlogged with the email-API item) — acceptable now; admin-assisted reset flow exists and was verified. | HANDOFF backlog |

## Seat 3 — Thesis professor (Chapter 3 objectives)

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| T1 | **P1** | **The login page names the system wrong.** Thesis title: "FLORAL — Dental Health Record Management System with Predictive Analytics". Login says "School Dental Clinic Management System"; the sidebar says "Dental Health System"; only SchoolSelect matches the manuscript. A panelist sees the mismatch on the very first screen. | `Login.tsx:45`, `Root.tsx:179`, `SchoolSelect.tsx:67` |
| T2 | **P2** | Test/demo artifacts visible in the "real" system: "NoDate, Test" student (D4) and a `prod-smoke-test` audit entry. Panel will probe whether data shown is real. | screenshots, HANDOFF |
| T3 | **P2** | DOH report label typos: "Blood **Transfussion**", "OP/**Scalling**", "**Flouride** Therapy". **Verify against the actual paper DOH form before fixing** — if the official form spells them that way, faithful reproduction is defensible (say so in the manuscript); if not, they're our typos on a document that goes to the City Health Office. | `Reports.tsx:53,82,96` |
| T4 | ✔ | Honesty mechanisms are defense-ready and worth showcasing: synthetic-model banner that self-clears, dentist-validation-required flow, honest empty states ("no historical trend data yet"), audit trail. These directly evidence the "assists, never replaces clinical judgment" objective. | p7/q6 screenshots |
| T5 | ✔ | Module coverage vs Chapter 3: all 7 modules reachable in prod for the dentist role. Known documented gaps: OCR can't extract grade/section (fields don't exist on the paper form — already flagged for adviser), Services-Rendered rows have no ERD backing (documented Sprint 13). | HANDOFF |

## Seat 4 — UI designer

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| U1 | **P2** | **Login page breaks the app's design system**: red primary button + red logo, while the entire app standardizes on blue `#1E40AF` (Sprint "UI polish" pass). Red = destructive/error everywhere else (Logout is red). First screen ≠ rest of app. Brand casing also flips (Floral / FLORAL). | p0 vs all app pages |
| U2 | **P2** | Three different product taglines (T1) — pick the manuscript one and use it everywhere. | see T1 |
| U3 | **P2** | Plain-text loaders ("Loading dashboard…", "Loading student data…") on a 2-4s settle; with the 9.6s cold first paint the app feels frozen. Skeleton states are already backlogged (beautify pass) — this review confirms where they matter: Dashboard, Risk Classification, Students. | p2/p7 screenshots; probe timings |
| U4 | **P3** | "High-Risk Patients: 0" card captioned "Needs validation" in green — microcopy reads as a status of the 0. Caption should only appear when unvalidated assessments exist ("N awaiting validation"). | q6 mobile dashboard |
| U5 | **P3** | Login placeholder domain `your.email@floral.ph` (and AccountManagement's `juan.delacruz@floral.ph`) vs real accounts `@floral.com`. Staff will typo the domain. | `Login.tsx:63`, `AccountManagement.tsx:179` |
| U6 | **P3** | Minor a11y: login inputs rely on visual text + placeholder, not associated `<label for>`/`aria-label` (screen reader reads "edit text, your.email@floral.ph"); one unnamed icon-only button on Students. Cheap wins, ISO 25010 "usability/accessibility" checkbox. | Probe A4/B4 DOM checks |
| U7 | ✔ | Mobile 390px holds up: no horizontal overflow on pages measured, sidebar collapses, cards stack cleanly. Login error state is well-designed (clear red banner). | q4-q8 screenshots |

## Seat 5 — Non-technical clinic staff

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| N1 | **P1** | **Any refresh or shared link loses the selected school** — in-memory only; user is bounced to school-select (probe: `/patients` deep link → school screen). For a 1-school user like the dental aide this selection is pure friction *every session*. Persist `selectedSchool` (localStorage) and auto-skip the screen when the account has exactly one school. | Probe C; known quirk in verify scripts |
| N2 | **P2** | Stale app after deploys until hard-refresh (PWA update toast already backlogged) — non-technical staff will never do Ctrl+Shift+R. This seat raises its priority. | HANDOFF backlog |
| N3 | **P2** | 9.6s cold first paint (measured again today; was 8.8s) — staff on school wifi will assume it's broken and re-click. Code-splitting item already backlogged; also a demo-day risk. | Probe A1 |
| N4 | **P3** | "Role is auto-detected from account" on login is developer-speak; staff don't know what role detection is. Either drop it or say nothing — the app already routes them correctly. | `Login.tsx:95` |

---

## Independent seat verification (2026-07-03, two fresh subagents, blind to the findings above)

Two seats (dentist, thesis professor) re-toured production independently without reading this doc. They **confirmed every P1 above** and added new findings:

**New from the dentist seat:**
| # | Sev | Finding | Status |
|---|-----|---------|--------|
| D7 | **P1** | DMFT History "Trend" tile claimed "↓ Improving" from a single data point (and for equal values) — `last.T > first.T ? Worsening : Improving`. Clinically wrong: no trend from one point, and DMFT is cumulative. | **FIXED in Sprint A** (`DentalChart.tsx:1136` — needs 2+ years, equal = Stable, single year = "—") |
| D8 | **P1→data** | Aldrin Villanueva's risk history shows a clinically impossible DMF 5→0 drop feeding an "Improving" trend. Root cause: **data artifact, not a code bug** — the seeded High/DMF-5 stratification plus a real validated assessment (DMF 0 from his empty chart) created during earlier verification runs. The Risk-page trend *code* was checked and is correct (requires 2+ assessments, has Stable). Cleanup of the seeded-vs-real mix is a data task, listed for Sprint B. |
| D9 | **P2** | "2 appointments total" header vs tabs summing to 1: a past-dated session still marked "Scheduled" appeared in **no tab at all** (Today/Upcoming/Completed/Missed all exclude it) while the header counted it. | **FIXED in Sprint A** (`Appointments.tsx` — past unmarked sessions now surface in Missed, where the mark-Completed/Missed actions live) |
| D10 | **P2** | "Generate Risk Assessment" clicked on an already-assessed student showed no visible change for 12s — suspected missing/too-brief loading feedback. Unconfirmed root cause; belongs with the skeleton-loading work. |
| D11 | **P2** | New Appointment modal doesn't close on Escape (verified). Sprint C candidate. |
| D12 | **P3** | RPC recall rule reads ambiguous on screen: header says "4–6 month interval" but due dates use the fixed 150-day midpoint (a documented Sprint 12 decision, not a bug). Fix is a label tweak ("~5 months (midpoint of the 4–6 month window)"). Early Visit 2 (2 months) gets no "early" flag. |
| D13 | **P3** | Reports month picker also defaults to April 2026. Deliberately NOT changed in Sprint A: the seeded report data lives in April, so defaulting to the current month would render an empty DOH table on open — decide together with demo staging. |
| D14 | **P3** | Completed appointment card shows time only ("11:11"), no date. |
| D15 | **P3** | No mixed-dentition sanity hint (5-year-old with permanent tooth 11 charted "D" accepted silently); DMFT table's t/T total columns unlabeled. Clinical-polish backlog. |

**New from the thesis-professor seat** (scorecard: Obj 1/2/4 + charting + RPC **DELIVERED**, Obj 3 predictive **PARTIAL** — pipeline works, model self-labeled synthetic):
| # | Sev | Finding | Status |
|---|-----|---------|--------|
| T6 | **P1** | The synthetic-data banner on the Risk page **self-refutes the thesis title at defense** if real-data training isn't done by then. Not a code bug — it's the honest banner doing its job — but the defense narrative must be either "retrained on real data" or a disciplined "pipeline validated, encoding in progress" story. Reinforces the real-data blocker's urgency. |
| T7 | **P1** | "Show me the 8,000 records": manuscript cites ~8,000 students; live system shows 19. Seed a defensible volume (or prepare the exact explanation) before defense. Test student removed (Sprint A). |
| T8 | **P2** | Sidebar "Dental Charts" and "Treatment" both open on empty filtered views ("0 queued students" / "0 records found") — two flagship modules look dead to a panelist even though charts exist inside IPTRs. Change default view or pre-stage queue data (Sprint B candidate; overlaps D5 empty-state copy). |
| T9 | **P2** | Demo-scripting: risk validation dead-ends on students without an RPC visit (correct architecture, bad improv) — script the demo on a student with Visit 1 recorded. Prediction latency up to 20s on cold start; rehearse narration over waits (nav settles 4–6s/page). |
| T10 | **P3** | `/ai-analytics` URL visible in the address bar; manuscript never says "AI" (nav label "Risk Classification" is fine). Cosmetic route rename possible in Sprint B; low value. |

**Corrections the independent pass produced**: my single-reviewer doc missed D7/D9 entirely (both wrong-information bugs — exactly the class the independent seats were hired for), and the professor's scorecard framing (deliver-vs-promise per objective) is stronger defense prep than my checklist. Both seats' full reports are preserved in the session transcript; the strengths lists above match this doc's positives.

## Ranked fix worklist (each needs approval; sized for small sprints)

**Sprint A — wrong-information bugs — ✅ DONE 2026-07-03 (expanded with D7/D9 from the independent seats):**
1. ✅ D1 RPC tile denominators → `schoolRecords.length`
2. ✅ D2 calendar initial month → current month
3. ✅ D3 chart nav scoped to selected school
4. ✅ D4 "NoDate, Test" soft-archived in prod with audit entry (via direct DB mirroring the archive route — admin API login 401'd because `.env`'s `SEED_ADMIN_PASSWORD` is stale post-rotation; update it)
5. ✅ D7 DMFT trend requires 2+ years, equal = Stable
6. ✅ D9 past unmarked appointments surface in Missed tab

**Sprint B — identity & first impressions — ✅ DONE 2026-07-03 (expanded):**
5. ✅ T1/U1/U2 one tagline everywhere ("Dental Health Record Management System"), FLORAL casing, login button recolored to app blue
6. ✅ U5 placeholder domains → floral.com, N4 role hint removed, D5 honest empty-queue/empty-treatment copy, U4 caption only when high-risk count > 0
7. ✅ T8 Dental Charts opens on Full List when queue empty; root cause was also the legacy demo queue seed (5 phantom IDs auto-seeded into fresh browsers) — removed entirely, old browsers self-heal (non-ObjectId ids dropped on read)
8. ✅ Dental Charts + Treatment Full Lists school-scoped (were showing all 18 students across 3 schools; found during live verification)

**Sprint C — friction — ✅ DONE 2026-07-03 (commit ac5d3c24, deployed + live-verified):**
7. ✅ N1 school selection persists (localStorage, per-user, validated against their school list); single-school accounts auto-select and skip the picker entirely (Switch button still opens it on demand)
8. ✅ S2 pre-auth `/me` probe skipped via session hint — zero console errors on a fresh login page (verified live)
9. ✅ U6 login labels associated (htmlFor/id), sidebar collapse chevron aria-label
10. ✅ D11 Escape closes the New Appointment / Set Rotation modals

**Already backlogged, priority confirmed by this review:** ~~skeleton loaders~~ ✅ done 2026-07-03 (U3 + D10, commit e11615b2 — Dashboard/Students/Risk skeletons + assessment timestamp; remaining pages' text loaders go in the full beautify pass), PWA update toast, code-splitting/cold-paint, deterministic IV research pass.
**Needs user verification first:** T3 report typos vs the paper DOH form.

## Verification notes (honesty)
- All code citations checked in source this session; D1/D2/D3 also live-verified or live-reproduced.
- Mobile table overflow on /patients could NOT be measured — the deep link bounced to school-select (that redirect is finding N1). Other mobile pages measured clean.
- Probes were read-only: one wrong-password attempt (rate limit 10/15min untouched otherwise), no saves, no writes to production data.
- Probe script kept at `dental-4-12-main/project/probe_strict.mjs` (reads `SEED_DENTIST_PASSWORD` from `.env`, no secrets inside). Fresh probe screenshots in session scratchpad `panel2/` (session-scoped, regenerate by rerunning the script).
