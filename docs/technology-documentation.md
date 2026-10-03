# FLORAL — Technology Documentation

**Group 404 · AY 2025-2026 · Capstone Build Phase**
Companion to `docs/chapter4-5-draft.md`. Documents every platform, service, and
library the system actually runs on: what each one does, where it surfaces in
the app, and how to look at it.

> **Scope note.** This is a *technology inventory*, not a setup guide. Installation,
> environment variables, and local-run instructions live in the root `README.md`
> and `ml-service/README.md` — they are deliberately not repeated here.

**How this document was verified (2026-08-05).** Every library in §3–§6 was
confirmed by locating an actual `import` of it in `src/`, `server/`, or `api/`.
Nothing here is listed merely because it appears in `package.json`. The 51
declared-but-never-imported packages are reported separately in §7 rather than
being presented as part of the system. To re-verify, cross-check each
`package.json` dependency against a project-wide search for its import string.

---

## 1. External platforms and services

These are the accounts and websites the system depends on. Four are load-bearing
in production; losing any one of them takes down a specific capability.

| Service | What it does for FLORAL | Where to look at it | What breaks without it |
|---|---|---|---|
| **GitHub** | Source of truth for all code and documentation. Also the deployment trigger — a push to `main` auto-deploys the frontend and backend. | `github.com/jirachi13/dental-app-build` | No deploys; no sync between the two dev machines |
| **Vercel** | Hosts the React frontend *and* the Express backend. Express runs as a serverless function via `api/index.ts`, not as a long-lived server. | https://dental-app-build.vercel.app · Vercel dashboard for logs, env vars, deploy history | The entire web app |
| **MongoDB Atlas** | The database. Holds all 16 collections from the Chapter 3 ERD. Cloud-hosted, not local. | Atlas web console → cluster → Collections | Everything — no login, no records |
| **Render** | Hosts the Python ML service separately from the main app, because it is a different runtime (Python, not Node). | https://floral-ml-service.onrender.com · Render dashboard | Risk Classification only; the rest of the app is unaffected |
| **Brevo** | Transactional email — password-reset links and 2FA codes. | Brevo dashboard → transactional log | Password reset and 2FA; normal login still works |
| **Figma** | Origin of the system. The UI began as a Figma Make prototype, later rebuilt into the real application. Residue of this history is still visible in `package.json` (see §7) and in the package name `@figma/my-make-file`. | Historical only — not part of the running system | Nothing (no runtime dependency) |

**Render's free tier has a visible behavior you should expect during a demo:**
the service sleeps after ~15 minutes idle. The first request after sleep takes
30–60 seconds and may return a 503 once; a retry succeeds. Wake it before any
live demonstration of Risk Classification.

---

## 2. How the pieces connect

A single request path, end to end:

```
Browser (React PWA on Vercel)
   │  fetch('/api/...')  — JWT in httpOnly cookie
   ▼
Express serverless function on Vercel  (api/index.ts → server/app.ts)
   │  auth middleware → RBAC role check → controller
   ├─────────────► MongoDB Atlas        (Mongoose; sensitive fields AES-encrypted)
   └─────────────► Render FastAPI       (only from server/routes/predictionRoutes.ts)
                        │
                        ▼
                   predictor.py → active model.pkl
```

Two architectural rules this diagram encodes, both from CLAUDE.md:

1. **The browser never calls the ML service.** Only Express does, through
   `predictionRoutes.ts`, using a server-side API key. This keeps the key out of
   client code and puts every prediction behind the same auth and audit layer as
   the rest of the system.
2. **Express never calls an individual algorithm file.** It calls `predictor.py`
   only, which is the Strategy Pattern entry point. Swapping algorithms is a
   `config.py` change, not an Express change.

---

## 3. Technology → where it appears in the app

The centerpiece of this document: for each user-visible capability, the library
that powers it and the exact click path to see it working.

| Capability | Technology | Where to see it in the app | Source |
|---|---|---|---|
| Page navigation, URL routing | **react-router 7** | Any sidebar click; the URL changes without a full page reload | `src/app/routes.tsx` |
| All dashboard and report charts | **recharts 2.15.2** | Sidebar → **Dashboard** (KPI charts) · **Reports** · **RPC Tracking** | `Dashboard.tsx`, `Reports.tsx`, `RPCTracking.tsx` |
| Every icon in the interface | **lucide-react** | Everywhere — sidebar glyphs, buttons, status chips | 24 component files |
| **OCR of paper DOH IPTR forms** | **tesseract.js 7** + **pdfjs-dist 6** | Students → **Add Student** → upload a scanned IPTR form; extracted fields populate the form with per-field confidence tints | `src/app/utils/iptrOcr.ts` |
| Excel export | **exceljs 4.4** | **Reports** → Export → Excel · also Students list export | `exportXlsx.ts`, `exportDohXlsx.ts` |
| PDF export (DOH report) | **jspdf 4.2** + **html2canvas-pro 2.2** | **Reports** → Export → PDF (~1.7 MB download) | `src/app/utils/exportPdf.ts` |
| CSV export | plain TypeScript (no library) | Audit Trail, Appointments, Students, RPC Tracking → Export → CSV | `src/app/utils/exportCsv.ts` |
| Offline support, installability, update prompt | **vite-plugin-pwa 1.2** + custom service worker | Only in a production build — go offline and the app still loads; the offline banner appears and submissions queue | `src/sw.ts`, `vite.config.ts` |
| Offline write queue | **IndexedDB** (browser built-in, no library) | Submit a form while offline → it queues FIFO and syncs on reconnect | `src/app/offline/` |
| Risk Classification (ML) | **Render FastAPI** via Express proxy | Sidebar → **AI Analytics** / Risk Classification. Dentist must validate before any clinical action. | `AIAnalytics.tsx` → `predictionRoutes.ts` |
| Typography | **@fontsource-variable/public-sans** | Global — the app's typeface, self-hosted (no Google Fonts request) | `src/main.tsx` |
| Styling system | **Tailwind CSS 4.1** + design tokens | Global. Tokens in `src/styles/theme.css`; see `DESIGN.md` for the rules | `src/styles/` |

**Note on the export libraries.** `exceljs`, `jspdf`, `html2canvas-pro`,
`tesseract.js`, and `pdfjs-dist` are all loaded via **dynamic `import()`**, not
top-level imports, and are excluded from service-worker precaching. This is
deliberate and must stay that way — importing them at the top level pushes the
bundle past the 2 MB precache limit and breaks the PWA.

---

## 4. Backend and security stack

All server-side, none of it visible in the UI — but each item maps to a specific
requirement in CLAUDE.md's security rules.

| Library | Role | Where |
|---|---|---|
| **express 4.22** | HTTP framework, MVC structure | `server/app.ts` |
| **mongoose 8.24** | MongoDB modeling for all 16 ERD collections; sanitization, no raw queries | `server/models/` (18 files) |
| **mongoose-field-encryption 7** | AES-256-CBC field-level encryption on patient PII, random IV per value | `Student.ts`, `MedicalHistory.ts`, `Treatment.ts`, `DentalAide.ts` |
| **bcryptjs** | Password hashing — no password is ever stored in plaintext | `server/utils/password.ts` |
| **jsonwebtoken 9** | JWT access (15 min) + refresh (7 day) tokens, delivered as httpOnly cookies | `server/utils/jwt.ts` |
| **helmet 8** | Security response headers (OWASP hardening) | `server/app.ts` |
| **express-rate-limit 8.5** | Brute-force protection on authentication endpoints | `server/routes/authRoutes.ts` |
| **cors 2.8** | Origin allowlist. A custom domain must be added to `ALLOWED_ORIGINS` or login breaks. | `server/app.ts` |
| **cookie-parser**, **dotenv** | Cookie reading; env loading | `server/app.ts` |

⚠️ **`FIELD_ENCRYPTION_SECRET` must never be changed.** Because each value is
stored as `<iv>:<ciphertext>` with a random IV, changing the key makes every
existing encrypted record permanently undecryptable. It is the single most
destructive configuration action in the system. A related consequence: plaintext
equality queries against encrypted fields never match — code must fetch and then
filter in JavaScript.

---

## 5. The ML service

Deliberately a separate deployment on Render, in a different language, behind an
API key.

| File | Role |
|---|---|
| `main.py` | FastAPI app — exposes `/health` and `/predict` |
| `predictor.py` | **The only entry point Express is allowed to call.** Strategy Pattern dispatcher. |
| `config.py` | Selects the active algorithm. Swapping models is a change here and nowhere else. |
| `train.py` / `evaluate.py` | Training and evaluation runs |

Python dependencies: `pandas`, `numpy`, `scikit-learn`, `xgboost`, `fastapi`,
`uvicorn[standard]`.

**Current honest status:** the pipeline is built and deployed end to end, but it
is trained on **synthetic data**. The real dental IPTR records have not yet been
located, so the published metrics in `docs/algo-results.md` are dry-run figures.
The app shows a synthetic-data banner to keep this visible rather than hidden,
and Chapter 4 §4.3 is marked `[PENDING]` for the same reason.

---

## 6. Development and verification tooling

| Tool | Purpose |
|---|---|
| **Vite 6.4** + `@vitejs/plugin-react` | Dev server and production bundler |
| **TypeScript 5.5** | Type checking across both frontend and server (`tsc --noEmit`, two configs) |
| **tsx** | Runs the TypeScript server and seed scripts directly, no build step |
| **Playwright 1.61** | Automated UI verification and Chapter 4 figure capture. Installed in `dental-4-12-main/project/node_modules`, **not** repo root — scripts must live and run there. |

Reusable verification scripts, all in `dental-4-12-main/project/`:
`verify_sprint33.mjs` (25 responsive assertions), `verify_live_smoke.mjs`
(11 end-to-end checks against production), `capture_figures.mjs`,
`capture_ml_figures.mjs`, `capture_export.mjs`. Each accepts `BASE_URL` to run
against production instead of localhost.

Seed scripts (`npm run seed:*`) populate demo accounts and student records.
Passwords come from `.env` and are never printed or committed.

---

## 7. Declared but unused dependencies

**Finding: of 73 runtime dependencies in `package.json`, only 22 are imported
anywhere in the codebase. 51 are never imported.**

These are residue from the original Figma Make prototype, which shipped a full
component library that the rebuilt application does not use. The unused set
includes all 26 `@radix-ui/*` packages, `@mui/material` and `@mui/icons-material`
with their `@emotion` peers, and `sonner`, `motion`, `vaul`, `cmdk`,
`react-hook-form`, `next-themes`, `react-day-picker`, `react-dnd`,
`canvas-confetti`, `embla-carousel-react`, `react-slick`, `input-otp`,
`clsx`, `tailwind-merge`, `class-variance-authority`, and others.

They are recorded here for three reasons:

1. **Accuracy.** A technology chapter that lists MUI and Radix as part of the
   system would misrepresent the build. The interface is hand-built on Tailwind
   with lucide-react icons — that is a more defensible claim, not a lesser one.
2. **Precedent.** This is the same class of issue as the ~23 dead design tokens
   deleted on 2026-07-28, and it was found the same way: search for real usage
   before believing a declaration.
3. **It is not urgent.** Unused dependencies are not bundled into production —
   Vite tree-shakes by entry point, so they cost install time and audit surface,
   not app weight. Removal is optional cleanup, and is **not** recommended
   before the defense: the risk of breaking a working build outweighs the
   tidiness gain.

---

## 8. Quick reference — where to look when something breaks

| Symptom | Look at |
|---|---|
| Whole app down | Vercel dashboard → latest deployment logs |
| Login returns 403 | `ALLOWED_ORIGINS` env var on Vercel |
| Records load but names are garbled | `FIELD_ENCRYPTION_SECRET` mismatch |
| Risk Classification times out | Render service asleep — retry after 30–60s |
| Password reset email never arrives | Brevo dashboard → transactional log |
| Changes not on the live site | Check the push actually reached `main` on GitHub |
| DOH report print is cropped | Known and unfixed — use PDF or Excel export instead |
