# FLORAL — Architecture

Where everything lives and how a request flows. Derived by reading the actual source
files on 2026-08-08, not from memory — re-verify after any structural change.

Companion docs: [`DATA-MODEL.md`](DATA-MODEL.md) (field-level model specs),
[`technology-documentation.md`](technology-documentation.md) (verified platform/library
snapshot), [`../DESIGN.md`](../DESIGN.md) (visual system).

---

## 1. Folder map

```
dental-app-build/
├── dental-4-12-main/project/     ← the app (frontend + backend together)
│   ├── src/                      ← FRONTEND (React + Vite)
│   │   ├── app/
│   │   │   ├── components/       screens and UI components
│   │   │   ├── api/              fetch wrappers calling /api/*
│   │   │   ├── hooks/            data hooks (useStudents, …)
│   │   │   ├── context/          auth/session state
│   │   │   ├── offline/          IndexedDB queue + service-worker glue
│   │   │   ├── utils/            chartColors.ts, iptrOcr.ts, …
│   │   │   ├── App.tsx           app shell
│   │   │   └── routes.tsx        client-side route table
│   │   ├── styles/               theme.css (design tokens)
│   │   └── sw.ts                 service worker (PWA/offline)
│   ├── server/                   ← BACKEND (Express, MVC)
│   │   ├── routes/               URL → handler wiring
│   │   ├── controllers/          request handlers with real logic
│   │   ├── models/               Mongoose schemas (the 16 ERD models)
│   │   ├── middleware/           auth.ts, roleGroups.ts
│   │   ├── utils/                jwt, mailer, password, auditLog, asyncHandler
│   │   ├── config/               db connection
│   │   └── scripts/              seeders (seed:admin, seed:students, …)
│   ├── api/index.ts              ← Vercel serverless entry (re-exports server/app)
│   └── public/                   static assets (logo, icons, manifest)
├── ml-service/                   ← ML (Python, FastAPI on Render)
│   ├── main.py                   FastAPI app
│   ├── predictor.py              the ONLY thing Express calls
│   ├── config.py                 active algorithm selection
│   ├── algorithms/               the 5 (strategy pattern, base.py + 5 impls)
│   ├── pipeline/                 clean_excel.py, build_features.py
│   ├── experiments/              training + comparison runs
│   └── active/                   deployed model.pkl
├── docs/                         manuscript, chapter drafts, figures, these docs
└── data/                         real Excel files (gitignored, per-device)
```

**Database has no folder.** MongoDB lives in Atlas (cloud). Its *shape* is
`server/models/`; its authoritative field spec is `DATA-MODEL.md`.

---

## 2. Request flow (MVC)

```
Browser (React)
   │  fetch('/api/students')        JWT in an httpOnly cookie
   ▼
Express  server/app.ts
   │
   ├─ middleware/auth.ts       requireAuth  → verifies JWT, sets req.user
   │                           requireRole  → checks role against the route's allow-list
   │
   ├─ routes/index.ts          matches the URL to a router
   │
   ├─ controllers/*.ts         the handler (auth, user, health)
   │     or crudFactory.ts     the generic CRUD handler (most models)
   │
   ├─ models/*.ts              Mongoose schema → MongoDB Atlas
   │
   └─ utils/auditLog.ts        writes an AUDIT_TRAIL row on every write
   ▼
JSON response  (encrypted fields decrypted on the way out)
```

In development the frontend runs on `:5173` and proxies `/api` to Express on `:4000`
(`vite.config.ts`). In production both are served by Vercel, with Express running as a
serverless function via `api/index.ts`.

---

## 3. The crudFactory pattern

**The single most important thing to understand about this backend.** Most endpoints are
not hand-written. `server/routes/crudFactory.ts` generates a full REST router for any
model:

```ts
router.use("/students", createCrudRouter(Student, { writeRoles: CLINICAL_WRITE_ROLES }));
```

That one line produces:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/students` | filters `isArchived: false` unless `?includeArchived=true` (System Admin only) |
| `GET` | `/api/students/:id` | validates the ObjectId first |
| `POST` | `/api/students` | protected fields stripped from the body |
| `PATCH` | `/api/students/:id` | same sanitization |
| `PATCH` | `/api/students/:id/archive` | soft delete — sets `isArchived`, `archivedAt`, `archivedBy` |
| `PATCH` | `/api/students/:id/restore` | System Admin only |

Every generated route already enforces `requireAuth`, `requireRole`, audit logging,
soft-delete filtering, field sanitization, and decrypt-on-response. **Add a model by
adding one line here** — don't hand-roll a router, or you will silently lose one of those
guarantees.

**Options:** `readRoles`, `writeRoles`, `archiveRoles`, `readOnly`. Defaults are
`ALL_ROLES` for read and `ADMIN_ONLY` for write/archive.

**Role groups** (`middleware/roleGroups.ts`):

- `ALL_ROLES` — system_admin, dentist, dental_aide, school_admin, bho_staff
- `CLINICAL_WRITE_ROLES` — system_admin, dentist, dental_aide
- `ADMIN_ONLY` — system_admin

### Interception

Some routes are registered *before* the generic router so they win the match — used where
the generic behaviour would be wrong. `POST /api/users` and the password / 2FA routes are
intercepted so passwords get bcrypt-hashed, since `password_hash` is a protected field the
generic router refuses to set. Order matters: an intercepting route must appear above its
`router.use(...)` line.

---

## 4. API surface

All paths are prefixed `/api`.

**Auth** (`routes/authRoutes.ts`) — rate-limited on the sensitive ones:
`POST /auth/login`, `/auth/verify-otp`, `/auth/forgot-password`, `/auth/reset-password`,
`/auth/refresh`, `/auth/logout` · `GET /auth/me` · `PATCH /auth/change-password`

**Predictions** (`routes/predictionRoutes.ts`) — dentist + system_admin only, every
assessment audit-logged. Express is the **only** caller of the ML service:
`GET /predictions/status`, `POST /predictions/assess`

**Users** — intercepted before generic CRUD: `POST /users`,
`PATCH /users/:id/reset-password`, `PATCH /users/:id/send-reset`,
`POST /users/:id/twofa/initiate|confirm|disable`

**Aggregates:** `GET /stats/high-risk-count` — server-side risk join for the sidebar
badge, so the client doesn't re-fetch six collections per page.

**Health:** `GET /health`

**Generic CRUD** (the six routes above, per model): `/schools`, `/users`, `/dentists`,
`/dental-aides`, `/students`, `/student-iptrs`, `/medical-histories`,
`/dietary-social-habits`, `/oral-health-conditions`, `/dental-charts`, `/tooth-records`,
`/treatments`, `/preventive-care-records`, `/risk-stratifications`, `/appointments`,
`/dentist-rotations`, `/audit-trails` (read-only, System Admin).

---

## 5. Conventions that bite if ignored

**Encrypted models must use `findById` + `save`, never `findByIdAndUpdate`.** Encryption
hooks don't fire on the latter, so the write lands as plaintext. Affects STUDENT,
DENTAL_AIDE, MEDICAL_HISTORY, TREATMENT.

**Plaintext equality queries on encrypted fields never match.** A random IV per encryption
means the same input produces different ciphertext every time. Fetch, then filter in JS —
see `seedStudents` / `seedRpcVisit2`.

**Never hard-delete.** Soft delete everywhere. All GET queries filter `isArchived: false`;
only System Admin can view or restore archived records.

**Never change `FIELD_ENCRYPTION_SECRET`.** It makes every existing record permanently
undecryptable.

**Express calls `predictor.py` only** — never an individual algorithm file. Swapping
algorithms is a `config.py` change.

---

## 6. Deployment

| Piece | Host | Trigger |
|---|---|---|
| Frontend + backend | Vercel | push to `main` auto-deploys |
| ML service | Render (free tier) | push auto-deploys; sleeps after ~15 min idle, first request 30–60s |
| Database | MongoDB Atlas M0 | — |

Production env vars live in the Vercel dashboard, same names as `.env`.
`ALLOWED_ORIGINS` must include the production origin or login breaks.
