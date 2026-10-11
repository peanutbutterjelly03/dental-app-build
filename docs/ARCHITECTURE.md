# FLORAL — Architecture

Where everything lives and how a request flows. Derived by reading the actual source
files — **re-derived 2026-09-11 (Sprint 151)**, first written 2026-08-08. Not from
memory; re-verify after any structural change.

Companion docs: [`DATA-MODEL.md`](DATA-MODEL.md) (field-level model specs),
[`technology-documentation.md`](technology-documentation.md) (verified platform/library
snapshot), [`../DESIGN.md`](../DESIGN.md) (visual system),
[`audit/trust-boundaries.md`](audit/trust-boundaries.md) (what is checked at each hop).

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
│   │   ├── models/               Mongoose schemas (19: the 16 ERD models + DayNote,
│   │                         Referral, DentistRotation — ERD deviations)
│   │   ├── middleware/           auth.ts, roleGroups.ts
│   │   ├── utils/                jwt, mailer, password, auditLog, asyncHandler,
│   │                         schoolScope.ts (school gate), secretGuard.ts
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
   ├─ utils/schoolScope.ts     scopeFilter / isInScope → restricts to the
   │                           caller's schools (Sprint 101) — see §2.5
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

## 2.5 School scoping — the multi-school gate

Added Sprint 101, and **absent from this document until 2026-09-11**. A user holds
`school_ids[]` in their JWT; `server/utils/schoolScope.ts` turns that into a filter.

`scopeFilter(modelName, req)` returns a MongoDB filter fragment, or `null` when no
restriction applies. `isInScope(modelName, req, doc)` answers the same question for a
single document — used on the write and read-one paths, where filtering a list is not the
question being asked.

**How each model reaches a school** (`RULES`, one entry per model — a model missing from
this table **fails closed** and returns nothing):

| Via | Models |
|---|---|
| `school_id` | Student, Dentist, DentalAide, DentistRotation |
| `student_id` | StudentIptr, Appointment |
| `iptr_id` | MedicalHistory, DietarySocialHabits, OralHealthCondition, DentalChart, Treatment, Referral, PreventiveCareRecord |
| `chart_id` | ToothRecord |
| `preventive_id` | RiskStratification |
| `school_id_or_global` | DayNote — a null `school_id` is a barangay-wide note **every** user must see; a plain `$in` would silently hide every holiday from scoped users |
| `none` (deliberate) | School (every user needs school names, and it is not patient data), User and AuditTrail (both already `ADMIN_ONLY` to read) |

Walking up a level costs a lookup, so a per-request memo (`req.__schoolScope`) resolves
each level once.

⚠ **Merge the clause with `$and`, never by spreading.** The scope clause keys on the very
same fields as `filterable` (`student_id`, `iptr_id`, `chart_id`), so
`{ ...filter, ...scope }` silently **drops the caller's filter** —
`GET /medical-histories?iptr_id=X` would return every in-scope medical history instead of
that pupil's, i.e. one child's record rendered under another's name.

⚠ **An empty `school_ids` means UNSCOPED, not unassigned.** `system_admin`, `bho_staff`
and both clinical roles legitimately hold none today, so the code reads an empty array as
"no restriction". A scoped user who ends up with an empty array therefore sees every
school. Recorded as **SEC-04**; do not rely on this behaviour either way until that row is
resolved.

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
| `PUT` | `/api/students/:id` | same sanitization. **`PUT`, not `PATCH`** — the body is partial all the same, so a `validateBody` must skip absent fields |
| `PATCH` | `/api/students/:id/archive` | soft delete — sets `isArchived`, `archivedAt`, `archivedBy` |
| `PATCH` | `/api/students/:id/restore` | System Admin only |

Every generated route already enforces `requireAuth`, `requireRole`, **school scoping**,
audit logging, soft-delete filtering, field sanitization, per-role redaction and
decrypt-on-response. **Add a model by adding one line here** — don't hand-roll a router, or
you will silently lose one of those guarantees.

Archived rows and out-of-scope rows both answer **404, not 403**, so their existence is not
confirmed to a caller who may not see them.

**Options** (`CrudOptions` — twelve, not the four this document listed until 2026-09-11):

| Option | What it does |
|---|---|
| `readOnly` | stop after the two GETs — no write routes at all (AuditTrail) |
| `readRoles` | who may read. Default `ALL_ROLES` |
| `writeRoles` | who may POST/PUT. Default `ADMIN_ONLY` |
| `archiveRoles` | who may archive. Default `ADMIN_ONLY` |
| `restoreRoles` | who may un-archive. Split from `archiveRoles` so clinical staff can archive while restore stays admin-only |
| `redact` | `{roles, fields}` — blanks fields on the way out for those roles. Blanks rather than deletes, so a missing key never reads as "not recorded yet" |
| `validateBody` | value rules on the RAW body, before encryption. Lives here so the **offline queue**, which replays POSTs through no form, is covered by the same rule |
| `uniqueBy` | hard 409 on duplicate field set. Counts only LIVE records — the archived-clash check lives on `restore` instead |
| `duplicateCheck` | soft 409 returning likely matches for the user to judge; overridden by `confirm_duplicate: true`. A callback, because encrypted names cannot be matched by query |
| `filterable` | whitelist of ObjectId FK fields for `?field=id,id`. ObjectId-only by design — `isValidObjectId` **is** the validation |
| `filterableText` | whitelist of unencrypted string fields, length-capped. ⚠ Never list an encrypted field: random IVs mean the match silently returns nothing |
| `dateField` | `?from=`/`?to=` bounding, inclusive instants. Opt-in per model |
| `auditCreateAction` | override the audit action string from the body |

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

**Aggregates — `GET /stats/*`, TWELVE routes, not one.** Hand-written server-side joins
that exist so a screen does not pull six collections into the browser to render a row:

| Route | Serves |
|---|---|
| `/stats/last-change` | newest AuditTrail timestamp — the refresh-on-focus probe |
| `/stats/high-risk-count` | sidebar badge |
| `/stats/notifications` | the bell — three sources, counts only |
| `/stats/reports-panels` | the Reports page's five reads |
| `/stats/fhsis` | FHSIS tallies |
| `/stats/school-summary` | per-school summary sheet |
| `/stats/rpc-rows` | RPC Tracking |
| `/stats/risk-candidates` | Risk Classification list |
| `/stats/risk-history` | one pupil's risk history |
| `/stats/doh-report` | the DOH consolidated report's arithmetic |
| `/stats/student-nav` | prev/next pupil |
| `/stats/student-rows` | the patient list's joined rows |

⚠ **This is a second read surface and it does not inherit the factory's guards.** All
twelve are `requireAuth` only — **none carries `requireRole`**. Eleven call `scopeFilter`
themselves; `/stats/last-change` needs none (it returns a bare timestamp). Redaction is
**not** applied, which is recorded as **SEC-03**. A new `/stats` route inherits nothing:
whatever it must enforce, it has to enforce itself. See `audit/LEDGER-sec.md` **ARCH-01**.

**Health:** `GET /health`

**Generic CRUD** (the six routes above, per model) — 20 mounts: `/schools`, `/users`,
`/dentists`, `/dental-aides`, `/students`, `/student-iptrs`, `/medical-histories`,
`/dietary-social-habits`, `/oral-health-conditions`, `/dental-charts`, `/tooth-records`,
`/treatments`, `/preventive-care-records`, `/risk-stratifications`, `/appointments`,
`/dentist-rotations`, `/day-notes`, `/referrals`, `/audit-trails` (read-only, System Admin).

---

## 5. Conventions that bite if ignored

**Encrypted models use `findById` + `save`, never `findByIdAndUpdate`.** Treat this as a
**convention whose stated reason has been wrong twice** — keep the rule, do not cite a
mechanism:

- It is *not* "the write lands as plaintext" (this document said so until 2026-09-11).
- It is *not* "the hook calls a removed Node crypto API" (its replacement, corrected the
  same day by Sprint 155). That API is `crypto.createCipher`, reached only via
  `encryptAes256Ctr`, selected by `options.useAes256Ctr` — which defaults to `false` and
  is never set in `shared/fieldEncryption.ts`. The live strategy is `encrypt`, using
  `crypto.createCipheriv`, which is present and working.

The real failure mode has not been re-derived. `save()` going through `pre('save')` is
known-good, so the rule stands on that alone. Affects STUDENT, DENTAL_AIDE,
MEDICAL_HISTORY, TREATMENT, REFERRAL.

✅ **Narrow exception, verified Sprint 155 (SEC-05, closed):** `crudFactory`'s archive and
restore routes use `findByIdAndUpdate` and are **safe**. The plugin's `updateHook` acts
only on encrypted fields actually present in the update
(`if (!encryptedFieldValue && plainTextValue)`), and those routes write only `isArchived`,
`archivedAt` and `archivedBy` — none encrypted on any model — so the hook does nothing.
They also skip `decryptForResponse` correctly: `post('init')` decrypts any document
mongoose hydrates, and `{ new: true }` returns a hydrated one.

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
| Frontend + backend | Vercel, region `sin1` (Singapore, Sprint 99 — ~4.2x faster than the default) | push to `main` auto-deploys |
| ML service | Render (free tier) | push auto-deploys; sleeps after ~15 min idle, first request 30–60s |
| Database | MongoDB Atlas M0 | — |

Production env vars live in the Vercel dashboard, same names as `.env`.
`ALLOWED_ORIGINS` must include the production origin or login breaks.

**`vercel.json` rewrites decide which half of the app a request reaches:** `/api/(.*)` goes
to the Express serverless function, `/((?!api/).*)` to `index.html`. Only the first half
passes through Express — so helmet's headers cover the JSON API and **not** the HTML
document that loads the application (recorded as **SEC-11**). Production is therefore
same-origin, which is why the CORS allowlist in `app.ts` names `:5173` and not the
production host.
