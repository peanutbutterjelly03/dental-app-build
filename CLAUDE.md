# FLORAL — Dental Health Record Management System with Predictive Analytics
Capstone Thesis — Build Phase — Group 404 — AY 2025-2026

## CONTEXT MANAGEMENT
- Read CLAUDE.md fully first, then HANDOFF.md if it exists
- /compact when resuming long sessions
- List file structure without reading every file; ask before reading additional files
- Save sprint summary as HANDOFF.md after each sprint
- Concise responses, no filler, no pleasantries

## DOC ROLES + SELF-MAINTENANCE (adopted 2026-07-04)
- **CLAUDE.md** = rules/specs/decisions that constrain every session. Self-improves by REPLACEMENT: when a decision supersedes a line, rewrite/delete it the same turn — never just append. Injected into every session, so bloat here taxes everything.
- **HANDOFF.md** = state journal (what happened, current status). All narrative goes here, never into CLAUDE.md.
- **PRODUCT.md** (root, for /impeccable) = stable design identity. Update only on a genuine strategic pivot; a churning PRODUCT.md is noise.
- **DESIGN.md** (root, for /impeccable — created 2026-07-28) = visual system. Keep in sync by RE-DERIVING via `/impeccable document` when the design system materially changes, not by hand-editing.
- **`/docs/technology-documentation.md`** = VERIFIED SNAPSHOT of platforms/services/libraries and where each surfaces in the app. Every entry was confirmed by locating a real `import` — never list a library because it appears in `package.json`. Re-run that import audit after any dependency change and once before defense; a stale snapshot here misrepresents the build in Chapter 4.
- Every ~5 sprints, do a CLAUDE.md hygiene pass: delete superseded lines, compress resolved sagas to one-liners, verify build-phase status markers.

## MODEL STRATEGY (updated 2026-07-10 → Fable available again)
- Fable is available again (2026-07-10). Split by task: **Fable = judgment** (scoping, plan mode, reviews, risky work), **Opus/Sonnet = execute written plans and light work** — premium capacity on light work is waste.
- Leave a precise plan in HANDOFF (or a plan-mode plan file) before executing, so any session/model can execute without re-deriving intent.

## BEHAVIOR RULES
- Think before coding, ask if unclear; simplicity first, no overengineering
- Surgical changes only, touch minimum files; minimum code that works, nothing more
- One sprint at a time — never start the next without approval; always commit after each sprint
- Confirm success criteria before building; ask clarifying questions if requirements unclear
- YAGNI: don't build it if it doesn't need to exist yet
- Prefer native platform features (e.g. `<input type="date">`) and stdlib/already-installed deps over new packages or custom code
- Before starting a sprint, give a one-line scope estimate (files touched, new models, complexity). Claude Code has no token/cost visibility here — this is the substitute for a usage warning.

## APP CONTEXT
- Floral — web app only (no NATIVE mobile app), internal use only, Barangay Tanyag, Taguig City
- **Three target device classes: phone, tablet, laptop/PC** (established 2026-08-25). "No mobile" above means no native app — the PWA IS used on phones in the field, so every screen must be checked at all three widths (~390px / ~768px / ~1280px+). Page headers stack below `sm:` and go side-by-side above it; tab strips and wide tables scroll inside their own container. Never leave a header or control row as a bare `flex items-center justify-between`.
- ~8,000 student records; 1 dentist, 1 dental aide, 3 clinic staff
- Three schools: (1) Bagong Tanyag Integrated School (primary, K-G10), (2) Bagong Tanyag Elementary School Annex A (K-G6), (3) South Daang Hari Elementary School Main (K-G6)

## SCOPE LIMITATIONS (do not build)
- No mobile app, no national DOH database integration, no computer-vision caries detection, no biometric auth, no tele-dentistry
- Predictive module assists dentist only, never replaces clinical judgment; standalone platform only

## TECH STACK
- Frontend: React (PWA) · Backend: Node.js + Express.js (MVC) · DB: MongoDB
- Offline: Service Worker + IndexedDB · ML: Python (scikit-learn, pandas, numpy) via FastAPI
- OCR: Tesseract.js · Evaluation: ISO/IEC 25010:2023

## USER ROLES (5 roles)
- **System Admin** (super user) — manage all user accounts (create/edit/deactivate), assign roles + school assignments, view full audit trail, restore archived records, system settings. Not in the Chapter 3 ERD's original role list but authoritative — required for the system to function, enforced via RBAC (Sprint 7).
- **Dentist** — patient records, dental charting, appointments, predictive analytics, treatment administration; validates ALL treatment recommendations before clinical action
- **Dental Aide** — patient records, appointments, clinic coordination, RPC monitoring
- **School Administrator** — view school reports + dashboards only, no clinical records
- **Barangay Health Office Staff** — consolidated reports across all schools, City Health Office report submission

## MONGODB MODELS (exact from ERD Chapter 3)
Full field-level specs for all 16 models live in **`/docs/DATA-MODEL.md`** — READ IT before touching any schema, model, or migration (moved out of CLAUDE.md to keep per-session context small; that doc is authoritative for field details). Models: SCHOOL, USER, DENTIST, DENTAL_AIDE, STUDENT, STUDENT_IPTR, MEDICAL_HISTORY, DIETARY_SOCIAL_HABITS, ORAL_HEALTH_CONDITION, DENTAL_CHART, TOOTH_RECORD, TREATMENT, PREVENTIVE_CARE_RECORD, RISK_STRATIFICATION, APPOINTMENT, DENTIST_ROTATION, AUDIT_TRAIL.

## SOFT DELETE RULES
- ALL models include: isArchived BOOLEAN default false, archivedAt DATETIME default null, archivedBy user_id default null
- All GET queries filter isArchived=false
- Only System Admin can view or restore archived records
- NEVER hard delete any record ever

## AUTH RULES
- JWT authentication, JWT expiry configured, refresh token handling
- 5 roles with strict RBAC; all routes protected by auth middleware; role checked on every API call
- bcrypt for all passwords
- Audit trail logs ALL user actions (additions, edits, archives) across all three school sites

## DATA ENCRYPTION
- Encrypt sensitive patient fields before saving to MongoDB. Do NOT encrypt fields needed for querying (isArchived, dates, IDs, role, school_id).
- Implemented Sprint 8 via `mongoose-field-encryption` (AES-256-CBC), scoped to: STUDENT (full_name, last_name, first_name, middle_name, address, contact_number, guardian_name, guardian_contact, philhealth_number, fourps_id, place_of_birth, guardian_occupation — last two added 2026-09-04), DENTAL_AIDE (contact_number), MEDICAL_HISTORY (allergies, others — not the boolean flags), TREATMENT (diagnosis, treatment_done). USER.full_name NOT encrypted (staff name, not patient PII). CRUD routes for these models use findById+save (not findByIdAndUpdate) — see HANDOFF Sprint 8 for why.
- **Random IV per encryption (Sprint 26)** — values stored as `<iv>:<ciphertext>`, decrypt reads the IV from the stored value, so plaintext equality queries on encrypted fields NEVER match (fetch + filter in JS instead; see seedStudents/seedRpcVisit2). NEVER change `FIELD_ENCRYPTION_SECRET` — that is the one action that makes existing records permanently undecryptable.

## SECURITY
- OWASP Top 10 compliance before deployment; ZAP scan after deployment
- .env never committed; no stack traces in error messages ever
- Input validation + sanitization on all routes; Mongoose sanitization, no raw queries
- Audit trail on all data changes

## SYSTEM MODULES (7 per Chapter 3)
1. User authentication + role-based access
2. Student registration + dental records (IPTR) — medical history, dietary/social habits, oral health conditions
3. Digital dental charting — tooth-by-tooth, standard notation, DMF/dmf index tracking
4. Appointment scheduling + monitoring — follow-up flagging, parental supervision flags
5. Two-visit RPC monitoring — Visit 1 + 2, oral screening, prophylaxis, fluoride varnish, hygiene instruction, caries risk assessment
6. Predictive analytics integration — risk classification (High/Medium/Low), treatment recommendations, dentist validation
7. Dashboard + automated DOH report generation — age-bracket + gender counts, monthly standardized reports, interactive dashboard

## OCR MODULE
- Tesseract.js scans DOH IPTR paper forms; extracts only what the form actually prints: name, birthday, age, sex, address, contact number, PhilHealth #, 4Ps/NHTS ID → structured JSON mapped to STUDENT fields. **Grade and section are NOT extracted — the official IPTR has no such field** (verified against the blank form, Sprint 87); they are typed. Occupation and Place of Birth are now on STUDENT (`guardian_occupation`, `place_of_birth` — added 2026-09-04) but OCR still does not extract either; both are typed only, same as Grade/Section.
- Ticked checkboxes are read by INK DENSITY per cell, not character recognition (Sprint 86), and findings are shown for review, never auto-applied. Both the grid reader and the field reader decline rather than guess — including on an upside-down page, where row identity would otherwise silently shift.

## PREDICTIVE ANALYTICS (Phase 3)
- Python (scikit-learn, pandas, numpy) via FastAPI. Key inputs: DMF/dmf index (PRIMARY), oral health conditions, dietary habits, medical history, treatment history. Risk output: High/Medium/Low.
- Pipeline: preprocess → feature-engineer → train + compare → risk output
- **Architecture:** Strategy Pattern for algo swapping. Active algo in config.py only. Express calls predictor.py only — never individual algo files. Dentist MUST validate before clinical action.
- **Algorithms (all 5 run — DECIDED 2026-07-02, SVM stays):** Logistic Regression, Decision Tree, Random Forest, SVM, XGBoost. Primary feature: DMF/dmf score. Metric priority: F1. Generate a visual decision tree for Chapter 4.
- **Evaluation (both, report Accuracy/Precision/Recall/F1/Confusion Matrix per algo):** Train/Test 80/20 (secondary) + Stratified K-Fold k=5 (**primary**, final selection by K-Fold F1). K=5 over K=10 because ~8,000 records with imbalanced conditions (rare conditions unreliable in K=10's smaller folds). Save results to `/docs/algo-results.md`. Train/Test-vs-K-Fold gap is itself a Chapter 4 discussion point (agreement = stable; K-Fold≫ = lucky split; K-Fold≪ = overfitting caught).
- **Real data is PAPER-ONLY (established 2026-08-06) — there are no files to locate.** Earlier notes said real dental IPTR Excel files "exist separately and must be found"; that was wrong. Barangay Tanyag's dental records are manual paper forms, so real training data only exists once hand-encoded. `/data/` holds Simplified Nutritional Status reports with ZERO dental fields (verified via openpyxl) and is not training data. Do NOT train against the Sprint 10 demo seeder (18 records — meaningless sample). **Hand-encoded sample size = 50 — DECIDED 2026-09-01** (was an open feasibility figure until the user confirmed it). Phase 3 is therefore a PILOT: report results with per-class support counts, sample size as a Chapter 5 limitation, no claim that any one algorithm is best. Cap the feature set at ~5 (≈10 records per feature) or RF/XGBoost will overfit and post meaningless scores. Dentist labels all 50 by hand (stronger basis than a threshold rule). **Stratify on RISK LEVEL ONLY** (revised 2026-09-01, superseding "risk level, school, and grade"): at n=50 the three-way split is not achievable — 3 risk × 3 schools is already 9 cells of ~5, and adding 11 grade levels empties most of them. Risk level is the label K-Fold depends on, so it is the stratum; school and grade are recorded as descriptive characteristics of the sample, not as strata. Record this selection method in Chapter 3. Expect wide fold-to-fold spread: k=5 over 50 records puts ~10 records in each test fold, so one misclassification moves per-class F1 visibly — that is the honest consequence of the sample, not a defect.
- **Privacy (RESOLVED):** `full_name`/any name column is dropped entirely from the ML pipeline (not just anonymized) — rows identified by student_id or a `Student_001` placeholder. Real names stay encrypted in MongoDB only. No adviser sign-off needed to proceed.

## REPORTING MODULE
- School Oral Health Status + Service Report; Consolidated Report for City Health Office (DOH-aligned)
- Age-bracket + gender counts, monthly automated generation, interactive dashboards, filterable/searchable records, follow-up alerts

## PWA / OFFLINE (Phase 2)
- Offline storage: IndexedDB. Sync FIFO (oldest timestamp first) — stop queue if sync fails, never skip. Background sync: Workbox.
- Show offline banner when disconnected; disable form submissions when offline.

## BUILD PHASES

**Completed work (Phase 1 Sprints 1–17, Phase 2 18–20, Phase 3 synthetic dry-run 21a–g, Phase 4 Sprints 22/24/25/26/27/27b + the 23-series beautify sub-sprints):** history moved to **`/docs/BUILD-LOG.md`**. Phase 1 + 2 are DONE and deployed. Only the pending items below remain.

**Phase 3 — Algo (BUILD DONE on synthetic data; re-run against REAL data BLOCKED — see Predictive Analytics above):** full 21a–21g task breakdown is authoritative in **`/docs/phase3-sprint-prompts.md`** — read it before any Phase 3 work; each sub-sprint needs approval before the next. Chapter 4: state that real IPTR records (after cleaning) were the training data — stronger than synthetic.

**PENDING backlog + Before-Defense checklist:** authoritative in HANDOFF.md (`## Open work`, `## User-only items`, `## Live warnings`) — state belongs there per DOC ROLES above. Each item needs approval; sprint loop applies.

## DENTAL CHART RESTORE POINT (set 2026-09-05, by user request)
- The user will ask, in plain words, to "go back to the version before I made changes in the dental charting tab" — possibly many sprints later. The baseline is **commit `176998c` on `majorUpdates`**, with a frozen copy at **`docs/snapshots/DentalChart.baseline-2026-09-05.tsx.txt`**. Do NOT try to reconstruct that layout by hand or from memory. (A git TAG was attempted and could not be pushed — this environment's proxy rejects `refs/tags`; don't rely on one.)
- **Full restore procedure, the whole-file caveat, and what the baseline looks like are in HANDOFF.md** under the ⭐ DENTAL CHART BASELINE section. Read it before restoring — `DentalChart.tsx` holds all six tabs, so a blind `git checkout <tag> -- <file>` also reverts the sibling tabs.

## SPRINT LOOP (every session)
- **Two local dev devices in use.** Git-tracked files sync only via push/pull — never assume HANDOFF is current without pulling. Per-device (NOT synced): `.env`, `data/` Excel files, `.claude/settings.local.json`, Claude auto-memory, and machine quirks (Node 24 DNS workaround applies to one machine only).
- **Start — PULL THEN READ, never read then pull.** `git pull` FIRST, before opening HANDOFF.md or any tracked file; only then read HANDOFF.md, /compact if resuming. If a pull isn't appropriate yet, **compare** instead — `git fetch` + `git rev-list --left-right --count HEAD...origin/main` — and state the behind-count before treating any file as current. An unpulled tracked file is UNKNOWN, not state: never claim "nothing is in progress", "X doesn't exist", or "the last sprint was N" from it. (2026-09-03: reading first put a session 43 commits behind — Sprints 56–80 — and produced a confidently wrong answer about the demo seed passwords; the failure is silent, a stale file reads as valid.) Complex sprints use /grill-me first: Sprints 1, 2, 7, 8, 16, 19, 21.
- **End:** save HANDOFF.md → git add . → git commit -m "Sprint X: description" → git push.

## CHAPTER REFERENCES
- `/docs/Group404 - Manuscript.md` — Chapter 1 (~line 95): objectives, scope, framework. Chapter 3 (~line 315): ERD, architecture, DFD, use cases, methodology.
- ERD = exact MongoDB models; use cases = exact permissions per role. Do NOT deviate from Chapter specs; read the relevant section before each sprint.

## NOTHING COSMETIC (user rule, restated 2026-09-02)
- **No fabricated or placeholder values anywhere in the UI.** Every figure is computed from the DB. Where there is no data, render EMPTY — never a guess, a sample, or a filler number. The seeded demo records are the only "placeholder", and they are real rows in the database that get purged before deployment.
- **A control that appears to work must work.** A filter that changes a label but not the data, an asterisk on a field that is not enforced, a period selector that filters nothing — these are placeholders too, and they are worse than a missing feature because the output looks authoritative. If it cannot be made real yet, remove it or say plainly on screen that it is not wired.
- **Official DOH forms keep ALL their rows and columns even when empty.** The form is the form; a blank cell on it is meaningful. Do not omit sections because the system has no source for them — leave them blank and note why.

## ABSOLUTE DO NOT
- Hard delete any record ever
- Build algo until Phase 3; call algo files directly from Express
- Start next sprint without approval; commit without testing
- Expose stack traces in errors; commit .env files
- Replace clinical judgment with predictions
- Build mobile app; integrate with national DOH databases
