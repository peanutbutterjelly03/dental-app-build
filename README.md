# FLORAL — Dental Health Record Management System with Predictive Analytics

Capstone thesis build (Group 404, AY 2025-2026). A web application for managing school dental health records across three public schools in Barangay Tanyag, Taguig City, with ML-assisted caries risk classification that **assists the dentist and never replaces clinical judgment** — every prediction requires dentist validation before any clinical action.

**Live app**: https://dental-app-build.vercel.app · **ML service**: https://floral-ml-service.onrender.com (free tier — sleeps after ~15 min idle; first request after that can take 30-60s)

## Architecture

| Piece | Tech | Where |
|---|---|---|
| Frontend | React + Vite, Tailwind, PWA (offline queue + update prompt) | `dental-4-12-main/project/src/` |
| Backend | Node.js + Express (MVC), JWT auth in httpOnly cookies, RBAC (5 roles), field-level encryption, audit trail | `dental-4-12-main/project/server/` |
| Database | MongoDB Atlas (16 models per the Chapter 3 ERD; soft delete everywhere — never hard delete) | — |
| ML service | Python FastAPI + scikit-learn (Strategy Pattern, `predictor.py` sole entry point) | `ml-service/` |
| OCR | Tesseract.js, client-side, scans paper DOH IPTR forms into the Add Student form | `src/app/utils/iptrOcr.ts` |

Deployment: frontend + backend on **Vercel** (Express runs as a serverless function via `api/index.ts`), ML service on **Render**. Express is the only caller of the ML service (`POST /api/predictions/*` proxies with an API key).

## Prerequisites

- Node.js 20+ (dev machine uses 24), npm
- Python 3.11+ with `pip install -r ml-service/requirements.txt` (only for the ML service / experiments)
- A MongoDB Atlas cluster (or connection string to the shared one)

## Environment variables

All backend env lives in `dental-4-12-main/project/.env` (**gitignored — never commit it**).

### Creating your `.env`

```bash
cd dental-4-12-main/project
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Then fill in the values. `.env.example` is committed and carries **placeholders only** — it is the template, not a working config. Generate the two JWT secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Three things decide whether the app will actually start and stay correct:

- **`MONGODB_URI`** — ask a teammate for the shared cluster string, or point at your own free Atlas cluster.
- **⚠ `FIELD_ENCRYPTION_SECRET` — if the database already has records, this MUST be the key they were encrypted with.** A wrong value does not fail at startup; it surfaces later as garbled names or decrypt errors when reading students, and the data cannot be recovered afterwards. Only generate a fresh one for an empty database. This is the single most destructive value in the project.
- **`ALLOWED_ORIGINS`** — keep `http://localhost:5173` for local dev, or every login returns `403 "Origin not allowed"`.

`ML_SERVICE_*`, `BREVO_*` and `RENDER_API_KEY` are optional locally; the app degrades sensibly without them (see the table below).

**Why the variable names appear here but no values do:** naming the variables is what makes the project runnable by someone else, and the names alone reveal nothing. The values are secrets and live in exactly two places — your untracked local `.env`, and the Vercel/Render dashboards for production. Never paste one into this file, `.env.example`, a commit message, or an issue.

Full reference:

| Var | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | token signing (15 min access / 7 day refresh) |
| `FIELD_ENCRYPTION_SECRET` | AES key for encrypted patient fields — **must match the key existing records were encrypted with**, a wrong value only surfaces as decrypt errors on read |
| `ALLOWED_ORIGINS` | CORS allowlist for production origins (login 403s without it) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DENTIST_PASSWORD`, `SEED_AIDE_PASSWORD`, `SEED_SCHOOLADMIN_PASSWORD`, `SEED_BHO_PASSWORD` | used by seed scripts and verification scripts; account passwords live only here and in the DB (bcrypt) |
| `ML_SERVICE_URL`, `ML_SERVICE_API_KEY` | Express → FastAPI proxy. **Both are OPTIONAL locally** and are normally absent from the dev `.env`: `predictionRoutes.ts` defaults the URL to `http://localhost:8000` and sends no API-key header when the key is empty, which is exactly what a local `uvicorn` expects. Set them in the Vercel/Render environments for production. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Transactional email for password-reset links. **Optional locally** — with no key, `mailer.ts` logs the link instead of sending it, so the reset flow is still testable without a mail account. |
| `RENDER_API_KEY` | Not read by the app at all — a personal token for managing the ML service through Render's API. Listed only so nobody deletes it wondering what it does. |

## Install

```bash
git clone <repo-url>
cd dental-app-build/dental-4-12-main/project
npm install
```

Everything (frontend, Express backend, seed and verification scripts) lives in that **one** `package.json` — there is no separate install for the server.

Optional, depending on what you are doing:

```bash
npx playwright install chromium              # only for the verification scripts below;
                                             # without it they fail with "browser not found"
cd ../../ml-service && pip install -r requirements.txt   # only for Risk Classification
```

Then create your `.env` as described above — the app will not start without `MONGODB_URI`.

### What a new collaborator cannot get from this repo

Three things are deliberately not in version control, and someone on the team has to hand them over or the setup stops here:

1. **`MONGODB_URI`** for the shared cluster — or use your own free Atlas cluster instead, and seed it (below).
2. **`FIELD_ENCRYPTION_SECRET`** — required if you point at the shared cluster, because existing patient records were encrypted with it. Not needed for your own empty cluster; generate a fresh one there.
3. **An Atlas IP allowlist entry for your machine.** Atlas rejects unknown IPs, and the failure looks like a hang or an SRV/DNS error rather than "access denied" — worth ruling out first if the server will not connect.

With your own empty cluster you need no secrets from anyone: generate all of them, then run the seeders in order to get schools, accounts and demo students.

## Run locally

Three processes, all from `dental-4-12-main/project/` (ML service from `ml-service/`):

```bash
# 1. Backend (Express on :4000)
npm run dev:server

# 2. Frontend (Vite on :5173, proxies /api -> :4000)
npm run dev

# 3. ML service (optional — only needed for Risk Classification)
cd ../../ml-service && uvicorn main:app --port 8000
```

Notes:
- **Vite must be on `:5173`.** `ALLOWED_ORIGINS` allowlists that exact origin, so if 5173 is already taken Vite silently moves to 5174 and **every login fails with `403 "Origin not allowed"`** — which reads exactly like a wrong password. Free the port first rather than accepting the one Vite picks.
- **Stopping the servers: `pkill -f "vite"` does NOT work on Windows.** Both processes run as `node`, so pkill matches nothing and exits quietly, leaving them running — the next start then fails with `EADDRINUSE :::4000`. Stop them by port:
  ```powershell
  Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- `npm run dev:server` runs `tsx watch server/local.ts`. `local.ts` preloads a `dns.setServers()` workaround for a machine-specific Node 24 + Atlas SRV-lookup failure — leave it in place.
- The service worker (offline queue, API caching, update prompt) **never runs under `vite dev`**. To exercise PWA behavior locally: `npm run build && npx vite preview --port 4173` (preview proxies `/api` to :4000 too).

### Seeding

Run in this order on an empty database:

```bash
npm run seed:admin          # system admin account (reads SEED_ADMIN_* from .env)
npm run seed:demo           # schools + one account per role
npm run seed:students       # demo students with IPTR/chart/risk data
npm run seed:rpc-visit2     # backdates RPC visits so all 4 statuses appear
npm run seed:iptr-details   # medical history / dietary / oral health records
npm run seed:treatments     # treatment codes on tooth records, so the DOH
                            # Program Report's Services Rendered section has
                            # numbers instead of zeros. Idempotent.
```

Maintenance and one-off scripts:

```bash
npm run apply:seed-passwords # push changed SEED_* passwords onto EXISTING accounts
                             # (seed:demo skips accounts that already exist, so
                             # editing .env alone never reaches them)
npm run restore:admin        # un-archive / re-enable the admin account
npm run backup:raw           # dump every collection to backups/<timestamp>/
npm run purge:demo           # remove the demo data set before real deployment
npm run verify:indexes       # assert the DB indexes exist AND the planner uses them
npm run migrate:iptr-grades  # one-off: backfill grade/section onto IPTRs
npm run fix:duplicate-iptr   # one-off: remove empty duplicate (student, year) IPTRs
npm run backfill:soft-delete # one-off: add soft-delete fields to old records
```

⚠ **Every seeder writes to whatever `MONGODB_URI` points at, and there is currently only ONE database** — no separate dev instance. Take `npm run backup:raw` before seeding anything you cannot recreate.

Gotcha: encrypted fields (`full_name`, `address`, `contact_number`, `allergies`, `others`, `diagnosis`, `treatment_done`, guardian/PhilHealth fields) **cannot be queried by value** — fetch and filter in JS after Mongoose decrypts on read.

## Testing / verification

No unit-test suite; the project standard is **end-to-end verification against real servers** (typecheck + build + Playwright scripts that exercise the live flows):

```bash
npx tsc --noEmit                            # frontend typecheck
npx tsc -p tsconfig.server.json --noEmit    # backend typecheck
npm run build                               # production build (+ SW precache report)
npm audit                                   # must stay at 0 vulnerabilities

# Playwright verification scripts (project root; read SEED_* passwords from .env):
node verify_risk_ui.mjs                # risk classification E2E (needs all 3 local servers)
node verify_decision_support_ui.mjs    # dentist decision support E2E (BASE_URL env to target prod)
node verify_pwa_toast.mjs              # SW update-toast flow + offline queue regression (needs :4000 + vite preview :4173)
node panel_tour.mjs / probe_strict.mjs # read-only production tours/probes (screenshots via SHOTS_DIR env)
```

Verification lessons that keep paying off: wait on real selectors, not fixed sleeps (cold start >5s); full-page screenshots restart recharts animations — count SVG marks in the DOM instead; after changing Vercel env vars, smoke-test an encrypted-model read (`/api/students`), not just login.

## Deployment

**`git push` to `main` DOES auto-deploy.** Vercel's Git integration builds and ships every push; no CLI step is needed.

```bash
git push          # that is the deploy
```

> ⚠ This corrects an earlier instruction in this file that said pushing does *not* deploy and that `npx vercel --prod` was required. That was true early in the build and has been wrong since the 23h–27b sprints. Re-confirmed 2026-09-03: Sprints 94–97 reached production from pushes alone — the live CSS carried the new `#67687A` token and the live JS the notification bell, with no CLI deploy.

The manual command still exists (`cd dental-4-12-main/project && npx vercel --prod`) but is only for forcing a redeploy without a commit.

**Verify a deploy actually landed** rather than assuming — a long-open tab can keep running the previous build (the app shows a "new version available" prompt, but only if the tab is looking):

```bash
curl -s https://dental-app-build.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Then fetch that bundle and grep for a string you know is new in this deploy.

- Production env vars are managed in the Vercel dashboard (same names as `.env`; `ALLOWED_ORIGINS` must include the production origin or login breaks).
- ML service: Render auto-deploys `ml-service/` on push to main (root dir `ml-service`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`). To retrain: `python ml-service/train.py`, commit the new `ml-service/active/model.pkl`, push.
- After deploys, open browsers show an in-app "new version available → Refresh" toast (no hard refresh needed).

## Data & privacy

- Patient PII is field-encrypted at rest (AES-256-CBC via mongoose-field-encryption); passwords are bcrypt(12); every create/update/archive/restore is written to the audit trail; nothing is ever hard-deleted.
- The ML pipeline **never sees student names** — training rows are identified by `student_id` only.
- The currently deployed model is trained on **synthetic placeholder data** (the UI says so on the Risk Classification page); it must be retrained on real IPTR records before defense. Raw data files under `data/` are gitignored.

## Project docs

- `docs/ARCHITECTURE.md` — folder map, MVC request flow, the crudFactory pattern, full API surface, conventions
- `CLAUDE.md` — build rules, ERD, sprint plan (Phases 1-4), model strategy
- `HANDOFF.md` — full build journal: every sprint's decisions, bugs found, and verification notes
- `docs/Group404 - Manuscript.md` — thesis manuscript (Chapters 1 & 3 drive the spec)
- `docs/algo-results.md`, `docs/model-selection-rationale.md` — ML experiment results (synthetic dry-run; regenerate on real data)
- `docs/persona-review-findings.md` — 5-persona production review, findings + fix history
- `docs/phase3-sprint-prompts.md` — authoritative Phase 3 task breakdowns
