# FLORAL — trust boundaries

Derived by reading source on **2026-09-11** (Sprint 151). Re-verify after any structural change.
Companion: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (how it is built),
[`LEDGER-sec.md`](LEDGER-sec.md) (what is wrong with it).

This answers one question per hop: **what crosses, and what is checked there.**

---

## The hops

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ B0  THE BROWSER — untrusted, and it holds plaintext PII         │
 │     React SPA · IndexedDB write queue · Cache Storage api-cache │
 └───────────────┬─────────────────────────────────────────────────┘
                 │  HTTPS · httpOnly + SameSite=Lax cookie · credentials:"include"
                 │  no CSRF token, and Lax makes that OK (SEC-07, closed)
 ┌───────────────▼─────────────────────────────────────────────────┐
 │ B1  VERCEL EDGE — the rewrite decides Express or static         │
 │     /api/*  → serverless function (region sin1)                 │
 │     /*      → index.html, NEVER through Express (SEC-11)        │
 └───────────────┬─────────────────────────────────────────────────┘
                 │
 ┌───────────────▼─────────────────────────────────────────────────┐
 │ B2  EXPRESS — the only place authorization exists               │
 │     helmet · CORS allowlist · requireAuth · requireRole         │
 │     · schoolScope · crudFactory guards · audit log              │
 │     ⚠ 12 /stats/* routes bypass most of this (ARCH-01)          │
 └────────┬──────────────────────────────────┬─────────────────────┘
          │ mongoose (TLS)                   │ HTTPS, public internet
 ┌────────▼─────────────────┐   ┌────────────▼────────────────────┐
 │ B3  MONGODB ATLAS M0     │   │ B4  RENDER — FastAPI ML service │
 │     field-level AES-256  │   │     floral-ml-service.onrender  │
 │     random IV per value  │   │     ⚠ auth unverified (Spr 157) │
 └──────────────────────────┘   └─────────────────────────────────┘
```

---

## B0 → B1 · browser to edge

**Crosses:** every API call, with an httpOnly `access_token` cookie attached automatically
(`client.ts` sends `credentials: "include"`).

**Checked:** nothing at the edge. The rewrite is routing, not security.

**What lives on the untrusted side, and matters:**

| Store | Contents | Cleared on logout? |
|---|---|---|
| `httpOnly` cookie | access + refresh JWT | cookies yes; **the tokens stay valid** — SEC-12 |
| `localStorage` / `sessionStorage` | staff identity (id, name, email, role, schools) | yes — `clearUserCache()` |
| IndexedDB | queued offline writes, incl. patient bodies | not established — Sprint 159 |
| Cache Storage `api-cache` | whole `/api/*` responses, **decrypted PII** | **no** — SEC-08, confirmed |

The last row is the one that matters. Field-level encryption protects patient data in Atlas; the API
decrypts on the way out; the service worker then writes that plaintext into the browser profile,
where it survives the session. On a shared clinic PC that is the weakest point on the whole map, and
it is not on the server side at all. Confirmed against `AuthContext.tsx:259-268`, which clears the
identity cache and never touches `api-cache`.

**Cookie flags** (`authController.ts` `baseCookieOptions`): `httpOnly: true`, `secure: isProd`,
`sameSite: "lax"` — so cross-site POST/PUT/PATCH never carries the cookie, which is why the absence
of a CSRF token is not a hole. Without "Remember me" no `maxAge` is set, making both session
cookies that die with the browser — the right default on a shared clinic PC.

**Token lifetime:** access 15 minutes, refresh 7 days. `client.ts` refreshes once transparently on a
401 and retries, with a single-flight `refreshPromise` so concurrent 401s share one refresh.
`refresh` re-reads the user from the database rather than trusting the token's claims, so a role
change, reassignment or archive propagates within 15 minutes.

⚠ **Logout is not revocation.** It clears cookies; nothing invalidates a token already issued, and no
`token_version` exists to check against. A password change does not end other sessions either
(SEC-12).

---

## B1 · the Vercel rewrite — one boundary, two very different halves

`vercel.json` sends `/api/(.*)` to the serverless Express function and everything else to
`index.html`. **Only the first half passes through Express**, so only the first half gets helmet.
The HTML document that loads and runs all the application JavaScript is a static asset with no CSP,
no `X-Frame-Options`, no `Referrer-Policy` (SEC-11).

Production is therefore **same-origin** — which is why CORS is a local-dev concern only, and why the
allowlist in `app.ts` names `:5173` rather than the production host.

`regions: ["sin1"]` (Singapore, Sprint 99) — latency, not security, but it is where the function
runs and therefore where patient data is processed.

---

## B2 · Express — the only authorization boundary in the system

Everything that decides *who may see what* is here. The client enforces nothing; hiding a screen is
a UX choice, not a control.

**The guard chain, in order, for a route generated by `crudFactory`:**

1. `requireAuth` — verifies the JWT from the cookie, sets `req.user = { id, role, school_ids }`
2. `requireRole(...)` — role against the route's allowlist
3. `scopeFilter` / `isInScope` — restricts to the caller's schools
4. archive visibility — archived rows are `system_admin`-only, answered **404 not 403** so their
   existence is not confirmed; out-of-scope rows get the same treatment
5. `sanitizeBody` — strips `_id`, the soft-delete trio, `password_hash`, and the 2FA/reset fields
6. `validateBody` / `uniqueBy` / `duplicateCheck` — per-model value rules
7. `redact` — blanks configured fields for configured roles on the way out
8. `logAudit` — an AUDIT_TRAIL row on every create, update, archive and restore

**The parallel surface that does not get this:** 12 hand-written `GET /stats/*` aggregate routes.
They carry `requireAuth` and nothing else — **no `requireRole` on any of the twelve**. Eleven call
`scopeFilter` themselves; four return pupil names with no redaction (ARCH-01, SEC-03). This is the
most important structural fact on the map: *the chokepoint has a road around it.*

### How scope is computed

`schoolScope.ts` holds one rule per model describing how it reaches a school — directly
(`school_id`), or by walking up `student_id` → `iptr_id` → `chart_id` → `preventive_id`. An unknown
model **fails closed** (`{ _id: { $in: [] } }`) so a model added later cannot become world-readable
by omission.

⚠ **But an empty `school_ids` means unscoped, not unassigned** — the same file fails *open* on
users (SEC-04). Today `system_admin`, `bho_staff` and both clinical roles legitimately hold no
`school_ids`, so "unscoped by role" and "assigned to nothing by accident" are the same state.

### Error handling

500s return a fixed generic body; the stack goes to `console.error` server-side only, which honours
CLAUDE.md's rule. Mongoose validation and cast messages are passed through verbatim (SEC-09).

---

## B2 → B3 · Express to Atlas

**Crosses:** mongoose queries over TLS.

**Checked:** nothing beyond the connection. **Authorization does not exist at this boundary** — any
code reaching a model can read anything. A query that forgets `scopeFilter` is unfiltered, and
nothing downstream will catch it. That is why B2 is the whole of the security model.

**Encryption:** AES-256-CBC field-level via `mongoose-field-encryption`, scoped to STUDENT,
DENTAL_AIDE, MEDICAL_HISTORY and TREATMENT. **Random IV per value** (Sprint 26), stored
`<iv>:<ciphertext>` — so plaintext equality queries on an encrypted field never match, and
`filterableText` must never name one or a filter silently returns nothing instead of failing loudly.

Decryption happens in `post('init')`, which `.lean()` and aggregation pipelines skip — the reason
`/stats/student-rows` must not be made `.lean()`, and the reason no aggregation can join on a name.

**Soft delete is a convention, not a constraint.** Nothing in Atlas enforces `isArchived`; it holds
because every read path filters on it.

---

## B2 → B4 · Express to the ML service

**Crosses:** the public internet, to `floral-ml-service.onrender.com`. Express is the only caller
(CLAUDE.md), and it calls `predictor.py` only, never an algorithm file.

**Checked:** `/predictions/*` is `requireAuth` + `requireRole` (dentist + system_admin) on the
Express side, and every assessment is audit-logged.

**Unverified, and it is the point of Sprint 157:** whether Render authenticates the inbound request
at all, and exactly which patient fields cross. CLAUDE.md requires names never leave MongoDB — rows
are to be identified by `student_id` or a `Student_001` placeholder. **That has not been confirmed
against the wire, only against the design intent.**

Availability: the free tier sleeps after ~15 min idle — first request 30–60 s and may 503 once.

---

## What is NOT a boundary, and is worth saying

- **The React app.** Route guards and hidden nav are convenience. Every control they imply must
  exist on the server, or it does not exist.
- **The offline queue.** `queueProcessor` replays writes through the same authenticated API, so it
  gains no privilege — but it also passes through **no form**, which is why value validation lives
  in `crudFactory.validateBody` and not in a submit handler. That is the gate that cannot be walked
  around.
- **The `verify_*.mjs` scripts.** They log in as real demo users over the real API and hold no
  special access. They read passwords from `.env`.
