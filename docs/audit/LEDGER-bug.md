# LEDGER — debugging track

Append-only. Stable IDs. **Nothing is deleted — status changes instead.**

Status: `OPEN` · `FIXED (Sprint N)` · `WONTFIX (reason)` · `NOT-A-BUG (reason)`
Severity: `HIGH` · `MED` · `LOW`

A row without an Evidence line (a `file:line`, or a command and its output) does not belong here.

> ⚠ **A PROCESS LESSON, 2026-09-11.** BUG-00 and BUG-01 were **seeded** into this ledger from a
> HANDOFF backlog entry rather than read off the code, and both turned out to have been **fixed
> before the audit started** — by Sprints 148/149/154, which landed after the backlog entry was
> written. They sat OPEN for eleven sprints, and BUG-00 was carried as the top HIGH the whole time.
> **A seeded row is a claim about the past. Verify it against current code before acting on it**, the
> same way a finding read off the code gets an Evidence line. (Second instance of this class this
> session: Sprint 160 nearly reported "2 of 20 hooks guard" from a truncated grep; it was 5.)

Track B sprints: 158 Vitest harness · 159 offline/sync races · 160 data-fetch hooks ·
161 report arithmetic · 162 `DentalChart.tsx` decomposition.

| Sprint | Surface | Status |
|---|---|---|
| 158 | Vitest harness + characterization tests | DONE — 46 tests, net verified, CI wired |
| 159 | Offline & sync races | DONE — 3 new, incl. a real double-drain race; SEC-27 confirmed |
| 160 | Data-fetch hooks | DONE — 3 new; the worst can show two pupils at once |
| 161 | Report arithmetic | DONE — **23 tests added**, 2 minor findings; the arithmetic largely held up |
| 162 | `DentalChart.tsx` decomposition | **PARTIAL** — 162a/b/c done (3088 → 2802). **Three panels remain: TAB 1, TAB 2, `ToothButton`** |

---

## Sprint 158 — the harness

`npm test` (`vitest run`) · `npm run test:watch` · a `Test` step in `.github/workflows/ci.yml`
between the typechecks and the build. **46 tests across three files, all passing.**

- `shared/studentValidation.test.ts` (25) — the gate `crudFactory` calls on every Student write, and
  the module's own header notes it is the **only** check the offline queue passes through.
- `shared/age.test.ts` (11) — the DOH age brackets, and the cross-implementation pins below.
- `src/app/utils/bmi.test.ts` (10) — BMI-for-Age, focused on the property that it **refuses rather
  than guesses** outside the table's 6–19 coverage.

**The net was verified, not assumed:** changing `getAgeGroup`'s `age <= 9` boundary to `age <= 8`
failed `getAgeGroup maps each boundary to its bracket`; the file was then restored and `git diff`
confirmed clean.

⚠ **Three items on the plan's original list were NOT testable as pure functions**, and none should be
forced: `computeDMFT` is module-local inside `DentalChart.tsx` (extracting it is Sprint 162's job,
and doing it here would be the refactor 158 exists to make safe); `readIptrCheckboxes` needs an
`HTMLCanvasElement`; `findDuplicateStudents` is async and queries the database. The plan's list was
written before Track A mapped the codebase — **the better target it did not know about is
`shared/`, 2,129 lines of framework-free logic imported by both server and client**, of which this
sprint covers three modules. `dohAggregate`, `rpcTracking`, `riskCandidates`, `schoolSummary`,
`fhsis` and `reportsPanels` are the obvious next ones, and they are exactly what Sprint 161 reads.

---

### BUG-02 · `shared/age.ts`, `shared/dohAggregate.ts`, `shared/studentValidation.ts` · MED · OPEN
Claim:    **There are THREE age implementations and TWO age-bracket implementations in `shared/`**,
          and every filed DOH figure is built on them.
Evidence: `age.ts:calculateAge(birthdate)` → `number | null`, always relative to today ·
          `dohAggregate.ts:ageAt(birthdate, on)` → `number | null` · `studentValidation.ts:ageOn(birth,
          on = new Date())` → `number`. All three run the same year/month/day arithmetic.
          Brackets: `age.ts:getAgeGroup` returns `'4 & below' | '5-9' | …`; `dohAggregate.ts:bracketOf`
          (module-private) returns `'4 yrs & below' | '5-9 yrs' | …` — **same boundaries, different
          labels**.
          `age.ts`'s own header warns about precisely this: "a second copy is how two screens end up
          disagreeing about which bracket a 9-year-old is in — the DOH reports are built on these
          boundaries, so a divergence would be a reporting error, not a cosmetic one." There are now
          three copies.
Impact:   **They agree today — this is latent, not live**, and Sprint 158's tests now pin them
          together so a future divergence fails loudly here instead of quietly in a report filed with
          the City Health Office.
          One real asymmetry is already pinned: **`ageOn` returns `NaN` on an unparseable date where
          the other two return `null`.** Safe today only because `validateBirthdate` guards with
          `Number.isNaN` before calling it; any new caller that skips that guard gets `NaN`, which
          fails every comparison silently rather than loudly.
Fix:      needs scoping — one age function taking an explicit `on`, one bracket function, and the two
          label sets kept as a presentation concern on top. ⚠ Not urgent, and **not** to be bundled
          into Sprint 161: that sprint reads the report arithmetic and should not also be changing
          the primitives underneath it.

---

## Seeded from HANDOFF (measured before the audit began — recorded, not rediscovered)

### BUG-00 · `src/app/hooks/useDentalChartData.ts:85` · HIGH · NOT-A-BUG (already fixed by Sprints 148/149/154)
**Closed 2026-09-11 without a code change. ⚠ It was already fixed before this audit began, and I
carried it as OPEN for eleven sprints without checking.**

The row was seeded from HANDOFF backlog #63, which describes the state on **2026-09-05**. Sprints
148, 149 and 154 landed after that date. All three parts of the original claim are addressed:

1. **Display** — `useDentalChartData` keeps **every** charting for the year, sorted oldest-first, and
   its comment names the bug directly: *"⚠ ALL of them, oldest first — `.find()` here is what hid
   every charting after the first (Sprint 148)."* The default shown is `charts[charts.length - 1]`,
   **the latest**, not the first — *"a pupil charted again in January showed August's findings."*
   `grep` for `myCharts.find` and `charts[0]` across the hook and the component returns **nothing**.
2. **Selection** — there is a real on-screen picker (`DentalChart.tsx:2142-2160`): one button per
   charting, shown when `charts.length > 1`, labelled with the date, annotated with the visit number
   where the charting is linked, and carrying the tooth-record count in its tooltip. `selectedChartId`
   also accepts a `?chart=` URL param. **A dentist can reach every charting of the year.**
3. **Creation** — a second charting *can* be made: `RPCTracking.tsx:132`, "Record visit & chart now",
   creates one attached to the visit via `preventive_id` and navigates straight to it.

⚠ **The `if (!chartId)` guard at `DentalChart.tsx:726` remains, and is now CORRECT rather than the
bug it was.** Editing appends to the charting currently selected; starting a new one belongs to
Record Visit. That is right: a charting created from the chart screen would be attached to **no**
visit, which is exactly the unlinked case `tallyIptrServices` has to fall back on. Do not "fix" it.

⚠ **Verified from code, not from a running app.** The measurement in the original row (22 of 26
IPTRs with more than one charting) was taken on dev and is not re-checked here.

### BUG-00 (original claim, as seeded) · HIGH
Claim:    The Dental Chart page shows only the FIRST charting of a school year and hides every later
          one, and no second charting can be created from the UI either.
Evidence: `useDentalChartData.ts:85` — `myCharts.find(c => c.iptr_id === iptr._id)` takes the first
          match; chart creation fires only `if (!chartId)`. **Measured on dev 2026-09-05: 22 of 26
          IPTRs have more than one chart.** One pupil has three (2025-08-14, 2026-01-19, 2026-07-09)
          and the page shows 3 of their 4 tooth records — the January finding is invisible.
Impact:   A dentist reading a pupil's chart sees an incomplete clinical record and is not told so.
Fix:      HANDOFF backlog #63 step 1 — show every charting for the year with its date, and allow a
          new one. ⚠ Deliberately NOT part of Sprint 162's decomposition: keeping the refactor
          behaviour-neutral is what makes a regression attributable to one change or the other.

### BUG-01 · `tallyIptrServices` vs `useDentalChartData` · MED · NOT-A-BUG (resolved with BUG-00)
**Closed 2026-09-11.** The contradiction was that the reporting layer assumed several chartings a
year while the chart screen assumed one. **Both now assume several**, so they agree:
`tallyIptrServices` orders multiple charts per IPTR and treats each as a sitting (re-read and pinned
by 13 tests in Sprint 161), and the chart screen shows all of them behind a picker (BUG-00 above).
Seeded from the same stale backlog entry as BUG-00 and carried open for the same eleven sprints.

### BUG-01 (original claim, as seeded) · MED
Claim:    The app contradicts itself about how many chartings a school year may hold.
Evidence: `tallyIptrServices` deliberately orders MULTIPLE charts per IPTR by date and treats each as
          a sitting — that is how the DOH report derives "1st / 2nd application".
          `useDentalChartData:85` assumes exactly one. Recorded in HANDOFF backlog #63.
Impact:   The reporting layer and the chart screen cannot both be right. Filed DOH figures rest on
          the reporting layer's assumption; the clinician sees the other.
Fix:      Resolved by BUG-00's fix plus backlog #63 steps 2–3 (nullable `preventive_id` on
          `DENTAL_CHART`, then reports read the link instead of inferring from chart dates).

---

## Sprint 159 — offline & sync races

**Read:** `offline/queueProcessor.ts` · `offline/queueEvents.ts` · `hooks/useOfflineQueue.ts` ·
`App.tsx` (the trigger site) · `offline/db.ts` and `sw.ts`, already in context from Sprint 156.

### What is correct here, recorded so no later sprint re-derives it
- **FIFO is real.** `getQueue()` reads through the `timestamp` index, and equal timestamps fall back
  to the autoincrement primary key, so the order is stable.
- **The queue stops rather than skips**, exactly as CLAUDE.md requires: a network failure `break`s
  and leaves the item pending; a server rejection marks it failed and `break`s. Only a *conflict*
  uses `continue`, and the comment records that as the user's explicit choice — one contested record
  should not wedge unrelated writes behind it.
- **`sendDirect` deliberately does NOT go through `apiClient`**, with the reason written down:
  `apiClient` queues failed writes, so reusing it would re-queue a failed sync attempt and defeat
  "stop queue if sync fails, never skip".
- `discardFailedWrite` exists precisely because a permanently-rejected item would otherwise wedge the
  FIFO forever. A failed item is recoverable by Retry or removable by Discard — both are offered.
- The conflict check compares **only the fields this write actually touches**, so an unrelated edit
  elsewhere on the same record is correctly not treated as a conflict.

### BUG-03 · `src/app/offline/queueProcessor.ts:4` + `src/sw.ts` · HIGH · FIXED (Sprint 159a)
**Fixed 2026-09-11, together with SEC-27 — they had one cause, so they got one fix: the queue row
carried neither an owner nor a cross-context claim, and now carries both.**

The guard moved from a module variable to the **row**: `claimWrite(id, contextId)` in `db.ts` reads
and writes the claim **inside a single readwrite transaction**, which is the part that matters —
IndexedDB serialises overlapping readwrite transactions on the same store, so two contexts calling it
at the same instant cannot both win. `processQueue` claims before sending and skips any row already
claimed. `CONTEXT_ID` distinguishes the page from the service worker. `CLAIM_LEASE_MS` (60 s) frees a
row whose context was killed mid-send; the failure paths `releaseClaim` explicitly so an ordinary
retry does not wait out a lease.

`processing` is kept and its comment corrected — it still stops one context re-entering itself, it
was simply never the cross-context guard it was taken for.

⚠ **Not claimed as solved: exactly-once.** A context killed *after* the server accepted a write but
*before* the row is removed will re-send after the lease expires. Closing that needs server-side
idempotency, which no route has. The window went from "two contexts racing on every reconnect" to
"a context dies in the gap between send and remove".

Verified: `npm test` 55/55, `tsc` both configs, `npm run build` — all clean. The new rules are unit
tested in `queueRules.test.ts` (9 tests), including the two cases that were wrong before.

Original finding follows.

### BUG-03 (original) · HIGH
Claim:    **The `processing` re-entrancy guard does not hold across contexts, so the queue can drain
          twice at once and send the same write twice.**
Evidence: `let processing = false` is **module scope**. The page and the service worker are separate
          JavaScript contexts with separate module instances — `sw.ts` imports `processQueue`, and
          the SW is built as its own bundle (`injectManifest`). So there are **two independent
          `processing` flags over one shared IndexedDB queue**, and neither can see the other.
          Both fire on the same event: `initQueueProcessor` adds a `window` `online` listener *and*
          calls `processQueue()` immediately when `navigator.onLine`; the SW's `sync` handler runs
          `processQueue()` on the `floral-queue-sync` tag. Coming back online and opening the app is
          the normal field workflow, and it triggers both.
          Nothing in IndexedDB prevents it: `getQueue()` is a readonly transaction and
          `removeFromQueue` runs only **after** a successful send, so both contexts read the same
          rows and both `sendDirect` before either removes.
Impact:   Depends on the model, and the quiet case is the bad one.
          **Models with `uniqueBy` or `duplicateCheck`** (StudentIptr, Student): the second POST gets
          a 409, which `markFailed`s and **wedges the whole queue**, showing the encoder "already
          exists" for a record they created once.
          **Models with neither** (ToothRecord, Treatment, DayNote, Appointment,
          PreventiveCareRecord, MedicalHistory): **two identical records, silently.** On a tooth
          record or a treatment, that is a duplicated clinical entry in a patient's chart.
          ⚠ Honest bounds: Background Sync is Chromium-only (registration is guarded by
          `'SyncManager' in window` and no-ops on Safari), and the two triggers must land close
          together. This is a race, not a certainty — but the window is the exact moment the feature
          exists for.
Fix:      needs scoping. The guard has to live where both contexts can see it — a claim/lease field
          on the queue row itself, written in the same readwrite transaction that reads it, not a
          module variable. ⚠ `navigator.locks` would be simpler but is not shared with the service
          worker in every browser; verify before choosing it.

### BUG-04 · `server/routes/crudFactory.ts` PUT · MED · FIXED (Sprint 159b)
**Fixed 2026-09-11, both halves.** Fixing only the server would have turned a silent bad write into
a wedged queue, which is not obviously better.

**Server:** `PUT /:id` now carries the same archived check `GET /:id` has — 404, not 403, and
admin-exempt, **mirroring the GET path exactly so the two cannot drift**. A System Admin may already
read archived records, so editing one stays their call; everyone else is not even told it exists.
That is the minimal symmetric choice. ⚠ The stricter alternative — refuse the edit for *everyone*,
on the grounds that an archived record should be restored before it is edited — was considered and
**not** taken, because it removes a capability an admin may rely on and this sprint was approved for
a bug, not a policy change.

**Client:** a 404 on a queued write now gets an actionable message instead of the server's "Not
found" — *"The record this change belongs to was archived or removed while you were offline… Discard
this change."* The write still fails and still stops the queue, which is correct under CLAUDE.md's
"stop queue if sync fails, never skip"; what changed is that the person clearing it is told Discard
is the action, not Retry.

**Also corrected while in that block:** the PUT handler's own comment still carried the ARCH-06
justification that Sprint 157a fixed in three other places. It now says the same thing they do.

⚠ **Not covered by an automated test.** This is a route guard over a Mongoose model, not a pure
function, so Sprint 158's harness does not reach it; the `verify_*.mjs` pattern is the right tool and
needs a live server, which SEC-00 blocks on this machine. Verified by `tsc` on both configs, `npm run
build`, and 55/55 unit tests — none of which exercise this line. **Worth a live check on the laptop.**

Original finding follows.

### BUG-04 (original) · MED
Claim:    **A queued edit can write into an archived record**, because `PUT /:id` has no archive
          check — and the offline path is how it actually gets reached.
Evidence: `crudFactory`'s `GET /:id` explicitly 404s an archived record for non-admins. **`PUT /:id`
          does not**: it is `findById` → `if (!doc) 404` → `isInScope` → `Object.assign(doc, updates)`
          → `save()`. `findById` finds archived rows.
          The offline route in: `checkForConflict` returns `null` on any non-OK response — including
          the 404 an archived record now gives — so the conflict check is skipped and the PUT
          proceeds normally.
Impact:   A pupil's record is archived while an aide is offline; the aide's queued edit syncs and
          writes into the archived record, which no screen lists. The edit lands somewhere invisible
          and the encoder is told it succeeded. Reachable through the API directly too, not only via
          the queue, so it carries a SEC cross-reference as well.
Fix:      Give PUT the archived check GET already has. ⚠ Then decide deliberately what the queue
          should DO with the rejection: `markFailed` wedges the queue, so this probably wants to be a
          conflict rather than a failure.

---

### BUG-12 · `src/app/hooks/useDentalChartData.ts:164` · HIGH · FIXED (2026-09-14)
**The definition was the user's call, made 2026-09-14: _"use latest charting with records, empty
shows not recorded."_** Implemented as `dmftRecordsForYear` in `utils/dentalChartCodes.ts` — a pure
function, so the rule is testable and cannot drift between the two screens that read it (the failure
BUG-02 and BUG-11 both record). The hook exposes it as `dmftToothRecords: ApiToothRecord[] | null`.

⚠ **`toothRecords` was deliberately NOT changed.** It is the charting being *viewed*, which is right
for the editor: open a fresh charting and you must see it empty, because you are about to fill it in.
Only the two **year-summary** readers moved to the new field — the year strip and the DMFT History
table. The editor's own live DMFT still reflects the charting in front of you.

**Verified live on the same pupil that exhibited it** (`6a9601a841e3a7b9e9c08350`, 2026-2027):
· DMFT History table `0 / 0` → **`d 2 · dmft 2 · D 14 · DMFT 14`**
· Trend **"Stable"** → **"↑ Worsening"**
· year strip `DMFT: 0` → **`DMFT: 16`**
**And the null path, on a second pupil** (`6a4439c0794468ceef36762c`, whose 2027-2028 and 2028-2029
hold no charting): both years now read *"Not recorded — no charting this school year"* across the
row, **Years tracked reads 1 rather than 3**, and Trend reads `—` instead of being computed off
fabricated zeroes.
✅ A year whose charting is all-sound still shows **0**, correctly — it has records. That is the
distinction the rule exists for, and it was confirmed on 2025-2026 for the first pupil.

96/96 tests (5 new on `dmftRecordsForYear`), `tsc` both configs, `npm run build` clean.

### BUG-14 · `ReferralsTab.tsx` vs `Reports.tsx:164` · MED · OPEN
**Found while extracting the Referrals tab, 2026-09-14. Moved verbatim, NOT reconciled — fixing it
is a form-fidelity decision, not a refactor.**

Claim:    **The DOH referral row labels exist in two copies, and they have already drifted.** Both
          claim to be the form's own printed wording; they cannot both be right.
Evidence: Three of the five differ:
          | key | chart screen | Reports screen |
          |---|---|---|
          | `higher_level` | Higher Level of Care **(unspecified)** | Higher Level of Care |
          | `oral_cancer_screening` | **Higher Level — **Oral Cancer Screening | Oral Cancer Screening |
          | `surgical` | **Higher Level — **Surgical Procedure | Surgical Procedure |
          (`primary_care` and `private_facility`'s stem agree.)
          The chart-screen copy's own comment states the stakes: *"the referral kinds are the DOH Oral
          Health Program Report's own printed rows, not a taxonomy of ours. Picking one here IS the
          report row the patient will be counted in."* The on-screen caption repeats it: *"Decides
          which row of the DOH Program Report this patient is counted in."*
Impact:   A dentist choosing "Higher Level — Surgical Procedure" on the chart and a reader seeing
          "Surgical Procedure" on the report are looking at the same stored value under two different
          names. Whether either matches the paper form is **unverified**. CLAUDE.md's strongest
          standing rule governs this — *"COPY OFFICIAL FORMS EXACTLY … in the form's own wording"* —
          and one of these two is violating it.
          ⚠ Only the LABELS differ; the stored `referral_type` values are the same enum, so **no
          filed count is wrong**. This is a naming defect, not an arithmetic one.
Fix:      **Read the DOH Oral Health Program Report's printed referral rows and make one copy match
          it**, then have the other import it. ⚠ Do not simply pick the longer or the shorter; the
          form decides. The manuscript's appendices or the supplied workbook are where to look.

### BUG-13 · `src/app/components/DentalChart.tsx` year strip · LOW · OPEN
**Noticed while fixing BUG-12; pre-existing and deliberately not changed.**
Claim:    The year strip labels `T + t` as "DMFT", while the DMFT History table reports the two
          separately. The same screen uses "DMFT" to mean two different things.
Evidence: Year strip renders `DMFT: {yrDmft.T + yrDmft.t}` — 16 for the pupil above. The History
          table shows `DMFT 14` (permanent) and `dmft 2` (deciduous) for that same year.
Impact:   Conventionally DMFT is permanent-only and dmft is deciduous; a combined figure under the
          uppercase label is mislabelled. Cosmetic on its own, but DMFT is the ML pipeline's primary
          feature name, so the ambiguity is worth removing before Chapter 4 quotes either number.
Fix:      Decide what the strip should show — the combined total under a clearer label, or the two
          figures — then make it match the table. Not changed here: it is pre-existing behaviour and
          BUG-12 was approved as a defined fix, not a relabelling.

### BUG-12 (original finding, as measured) · HIGH
**Found by the browser pass, 2026-09-11, on live data. Pre-existing — NOT introduced by Sprint 162;
the 162b extraction moved the rendering code verbatim and this comes from the hook it reads.**

Claim:    **An empty later charting zeroes out the whole school year's DMFT.** The screen reports a
          confident `0` for a pupil with fourteen decayed permanent teeth.
Evidence: Measured on the running app against the production database, pupil
          `6a9601a841e3a7b9e9c08350`, school year 2026-2027, which holds two chartings:
          · **Sep 6** (`6a9d27077a10cd662f3c2882`) — **35 tooth records**: 14 `D`, 2 `d`, plus ✓/JC/jc.
          · **Sep 7** (`6a9e7032a4c506cd6f6439ff`, the RPC-linked one) — **zero tooth records.**
          `useDentalChartData:164` — `toothRecords: dentalChart ? allToothRecords.filter(t =>
          t.chart_id === dentalChart._id) : []`, and `dentalChart` is `charts[charts.length - 1]`,
          **the latest**. So the year's tooth records are the *latest charting's* records, which here
          are none.
          On screen: the DMFT History tab prints `dmft 0 / DMFT 0` for 2026-2027 and a **Trend of
          "Stable"**; the year strip prints `2026-2027 · DMFT: 0`.
Impact:   **A clinical screen states there is no disease where there are fourteen decayed teeth**, in
          a year where the decay *is* recorded and one click away under the other date button. The
          `0` reads as a finding, not as "not recorded" — exactly what CLAUDE.md's NOTHING COSMETIC
          rule forbids. DMFT is also CLAUDE.md's **PRIMARY** feature for the predictive model.
          ✅ **Filed DOH figures are NOT affected.** `tallyIptrServices` iterates **all** charts per
          IPTR server-side (re-read and pinned by tests in Sprint 161), so the reports compute from
          every charting. This is a screen defect, not a reporting one.
Fix:      needs scoping, and it is a **definition question first, not a coding one**: what is "the
          year's DMFT" when a year holds several self-contained chartings?
          ⚠ The user's own 2026-09-05 decision — each charting is one visit's findings, read alone,
          never merged — argues against summing them. The likely answer is **the latest charting that
          actually has tooth records**, with an empty charting showing "not recorded" rather than 0.
          ⚠ Do not simply take the max across chartings without deciding this; DMFT is cumulative in
          principle but these are independent snapshots in this data model.

---

## Sprint 162 — `DentalChart.tsx` decomposition · **PARTIAL, stopped cleanly**

**Two extractions, each verified before the next. 3,088 → 2,934 lines.** No behaviour change was
intended and none was made: every step ran `tsc` on both configs, `npm test` and `npm run build`.

**162a — the chart's vocabulary and arithmetic** → `src/app/utils/dentalChartCodes.ts` (132 lines).
FDI tooth layout, condition/treatment code tables, colours, `computeDMFT`. The coupling mattered more
than the line count: **Dashboard, Reports, RPCTracking and IptrForm all imported `treatmentCodes` /
`treatmentLabel` from a 3,088-line component**, so opening any of those screens pulled the whole
chart module in behind them. All four now import from the new module — which is why that commit
touches five files and leaves no re-exports. Leaving them would have kept the coupling.
**It also unblocked Sprint 158's deferral:** `computeDMFT` now has 13 tests, including a pin on the
deliberate `X`/`x` vs `DX`/`dx` divergence from the printed DOH legend so nobody "fixes" it, and one
recording that a **miscased entry is silently dropped from both indices** (an uppercase code on a
deciduous tooth counts as neither) — pinned as current behaviour, not endorsed.

**162b — the DMFT History tab** → `src/app/components/DmftHistoryTab.tsx`. Of the seven panels this
is the only one reading **nothing but `years`** — no handlers, no local state, no callbacks — so it
moves on one prop.

### ▶ 162c — the seam map, at CURRENT line numbers (2026-09-11, after 162a/b)
Re-derived after the extractions rather than carried over, because a stale map is worse than none.

| Panel | Line | Approx size | Note |
|---|---|---|---|
| TAB 1 History | `:1788` | ~190 | plus a related block at `:1734` |
| **TAB 2 Dental Chart** | `:1981` | **~555** | the big one — odontogram, palette, summaries |
| TAB 4 DMFT History | `:2536` | — | **DONE (162b)** |
| TAB 5 Treatment History | `:2539` | ~75 | |
| TAB 6 Referrals | `:2617` | ~170 | |
| TAB 7 AI Risk | `:2791` | ~45 | |
| `ToothButton` | `:916` | — | an inner component; a seam **within** TAB 2, extractable first |

⚠ **Why this stopped here, and it is not an arbitrary budget cut.** The two extractions done were
*structurally* safe — one moved non-React constants, the other a panel with a single prop. **The
remaining six panels all share mutable chart state with the host**, so each needs its handlers
threaded deliberately, and a mistake there changes behaviour silently on a clinical screen. That is a
different risk class and deserves its own approval, not the tail end of a sprint.

⚠ **Order for 162c:** smallest first — TAB 7, then TAB 5, then TAB 6, then TAB 1 — and leave **TAB 2
last**, extracting `ToothButton` before attempting the panel around it. One commit per extraction,
`tsc` ×2 + `npm test` + `npm run build` after each, exactly as 162a/b did.

⚠ **BUG-00 still lives in `useDentalChartData`** and must be fixed **before or after** 162c, never
inside it.

⚠ **Neither extraction is covered by a rendering test** — the suite is pure functions only. `tsc`
proves the wiring, not the pixels.

### ✅ Browser pass 2 — done 2026-09-14, verifying the four panels 162c extracted
All four render and all their props are wired. Checked against live data, read-only, nothing saved.
- **History** (9 props, the largest surface): physical measurements with BMI and Nutritional Status
  both reading "Automatic", all 9 medical chips plus Allergies, all 7 dietary chips, the full RA
  10173 notice, and the appointments panel showing "No upcoming appointments scheduled."
- **Treatment History**: heading, Add Entry, empty state. Opening the add form proved the whole
  `addForm` bundle — *"Adding to school year: **2026-2027**"*, the date defaulted to today, and
  **"Dr. Maria Santos" under the label "Dentist"**, which is `staffName` + `staffNameLabel` resolving
  by role.
- **Referrals**: same, and the Referred-For dropdown renders `REFERRAL_TYPE_LABELS` from its new home
  — showing **"Higher Level of Care (unspecified)"**, which is BUG-14 visible on screen.
- **AI Risk**: message and the `/ai-analytics` link both present.

⚠ **One false alarm worth recording:** clicking Add Entry by element `ref` did not dispatch and the
form stayed shut, which looked exactly like a broken binding. Clicking by **coordinate** worked. The
tool, not the app — but the first reading would have been a wrong finding.

### ✅ Browser pass 1 — done 2026-09-11, against the running app on live data
- **162a/b verified.** The chart screen renders correctly, the tab strip works, and the **DMFT
  History tab — the panel 162b moved into its own file — renders with its table, its caption and all
  four KPI tiles.** No regression from either extraction.
- **BUG-00 verified live**, which closes the last doubt about it. On a pupil with two chartings the
  picker reads `Charting: [Sep 6, 2026] [Sep 7, 2026 · Visit 2 · latest] — 2 chartings this school
  year`. Clicking **Sep 6** switched the examination date, unchecked the four services, and populated
  **35 tooth records** where the latest charting showed none. The default really is the latest, and
  the visit annotation really does appear on the linked charting.
- ⚠ **Phone width NOT verified.** `resize_window` reported success at 390×844 and the window stopped
  at **1098 px** — the OS/browser minimum. This is the same tool limitation HANDOFF recorded in the
  10th session. **390 px still needs a human with devtools device emulation**; window resizing cannot
  reach it.
- **BUG-12 was found during this pass** — see above. It is pre-existing, not a 162 regression.

---

## Sprint 161 — report arithmetic

**Read:** `shared/dohAggregate.ts` (the tally and aggregate), `shared/schoolYear.ts`,
`shared/rpcTracking.ts` (the school-year cutoff), plus a division sweep across all of `shared/`.
**Wrote 23 tests** — this is the first audit sprint that could, because the report arithmetic is pure
functions, which is exactly what Sprint 158's harness was built for. 78/78 green.

### ▶ The headline is that this arithmetic held up
Unlike Sprints 159 and 160, this sprint largely **validated** the code rather than finding holes in
it. Sprints 138–150 did careful work here and it shows; the two findings below are both LOW.

- **`tallyIptrServices` behaves exactly as documented**, including the compatibility guarantee that
  matters most: **with nothing linked — which is all real data today — it reproduces the
  pre-Sprint-150 numbers exactly**, so Sprint 150 did not move any filed return. Now pinned by test.
- The linked/unlinked rule is **per CODE, not per chart**, and the case its docblock records as a
  real regression (a code appearing only in a pupil's *third* charting still counting as a 1st
  application — caught by diffing filed numbers, `sdf_1st` 9→7 and `sdf_2nd` 0→2) is genuinely
  handled. Pinned.
- **Sittings, not teeth**: five teeth varnished in one visit is one application, not five. Pinned.
- **No division by a count anywhere in `shared/`.** The empty-cohort divide-by-zero the plan asked
  about does not exist — these aggregates are counts and sets throughout, and no percentage is
  computed in the shared layer.
- ⚠ **The plan's concern about "1st/2nd application inferred from chart dates" is RESOLVED and the
  plan is simply out of date.** Sprint 149 gave `DENTAL_CHART` a `preventive_id` and Sprint 150 made
  the ordinal a lookup; the date-order rule survives only as the fallback for pre-149 chartings,
  which it has to, or services would vanish from returns already filed.

### BUG-10 · `shared/schoolYear.ts` `schoolYearEnd` · LOW · OPEN
Claim:    **The displayed RPC deadline and the enforced one disagree by up to 24 hours**, because
          `schoolYearEnd` returns the *start* of the last day.
Evidence: `schoolYearEnd` returns `new Date(y, 3, 30)` — April 30 at **00:00:00**.
          `rpcTracking.ts:273-280` compares `windowCloses > syEnd.getTime()` to decide `syCutoff`
          ('tight' / 'impossible'), then formats `syDeadline` as `"YYYY-04-30"` and shows it.
          So a second-visit window closing at 09:00 on April 30 is past the **enforced** deadline
          while still inside the **displayed** one. Pinned in `schoolYear.test.ts`.
Impact:   Small and narrow — it can label a pupil's second RPC visit 'tight' or 'impossible' a day
          early, which is a warning shown to staff rather than a filed figure. No DOH number moves.
Fix:      Either return the end of April 30 (23:59:59.999) or compare against the start of May 1.
          ⚠ Check both call sites together — `rpcTracking.ts` and `Appointments.tsx:105` — since
          changing the returned instant changes both.

### BUG-11 · `server/scripts/migrateIptrGrades.ts:37` · LOW · OPEN
Claim:    A duplicated school-year rule survives in a script **whose stated reason for existing has
          been removed**.
Evidence: `migrateIptrGrades.ts:37` carries its own `schoolYearLabel` —
          `d.getMonth() <= 3 ? \`${y-1}-${y}\` : \`${y}-${y+1}\`` — identical to `shared/schoolYear.ts`.
          That file's own header explains why: server code could not import from `src/` — and then
          says **"`shared/` removes that excuse — one school-year rule for every consumer, which is
          the whole point of the file."** The excuse is gone; the copy is not.
          A fifth variant also exists privately: `dohAggregate.ts:207` `schoolYearStartDate` parses a
          year label without using `shared/schoolYear.ts`.
Impact:   Latent, same family as BUG-02's three age implementations. They agree today. The risk is a
          future change to the June–April rule (or to May's bucketing) landing in `shared/` and not
          in the migration script, which would then write school-year labels that disagree with every
          reader of them.
Fix:      Import from `shared/` in the script — the constraint that prevented it no longer applies.

---

## Sprint 160 — data-fetch hooks

**Read:** all 20 of `src/app/hooks/*` — structurally first (dependency arrays, guard patterns), then
in full for the ones whose inputs a user can change quickly.

**The shape of this sprint's findings: the fix already exists in this codebase.** Five hooks guard
against out-of-order responses (`useDohReportData` and `useSchoolSummary` with an `isStale()` /
`runIdRef` pair, `useGradeRoster` and `useLiveNumbers` with a `cancelled` flag, `useStudentNav`).
Fifteen do not. So this is not "nobody thought about it" — it is a known, working, in-house pattern
applied to some hooks and not others.

⚠ **A correction to my own first pass, recorded because it nearly became a wrong finding.** An early
grep truncated at 10 lines and I read it as "only 2 of 20 hooks guard". The real count is 5 of 20;
`useDohReportData` and `useSchoolSummary` both guard and were missed. Counts here come from a
per-file check, not a truncated grep.

### What is correct here
- **Dependency arrays are overwhelmingly primitives** — `fromMs`, `toMs`, `fromKey`, `key`,
  `schoolName`, `schoolYear`, `studentId` — not objects or arrays. That is the right defence against
  the refetch loop HANDOFF documents for `useAppointments`, and it has been applied broadly.
- `useRefreshOnFocus` is unusually well-reasoned: throttled at 30 s, listening on `visibilitychange`
  / `focus` / `online`, with an explicit argument for why an interval is the wrong shape (a billed
  invocation per tick to keep an unwatched tab warm) and an explicit warning never to put it on a
  screen holding unsaved edits.
- `useAppointments` uses `pendingWrites.length` as an effect dependency — the correct defensive form
  for an array whose identity changes every render.

### BUG-07 · `src/app/hooks/useDentalChartData.ts:162` · HIGH · FIXED (Sprint 160a)
**Fixed 2026-09-11.** Adopted the in-house `runIdRef` / `isStale()` pattern from `useDohReportData`
rather than inventing a third variant — the codebase already had two.

**Guarded at five points, not one**, which is the whole reason this bug was worse than staleness:
- `:104` **commit point 1** — identity (`setStudent`, `setSchoolName`, `setDentists`). Returns rather
  than falling through, so a superseded run also stops issuing its second round of requests.
- `:174` **commit point 2** — `setYears`.
- `:181` the error path, so a superseded run's failure does not raise "Failed to load" over a pupil
  the user has already navigated past.
- `:186` `endLoad`, so an abandoned run finishing first cannot report the screen ready while the run
  whose data is actually wanted is still in flight.
- `:194` effect cleanup bumps the id on unmount, matching `useDohReportData`.

⚠ **Checked before writing it: `useLoadPhase` is idempotent, not a counter** (`beginLoad` sets a
flag, `endLoad` clears it unconditionally), so gating `endLoad` cannot unbalance anything and leave a
stuck spinner. The newest run always clears it.

⚠ **Not unit-tested**, for the same reason as BUG-04: this is a React hook over `apiClient`, and
Sprint 158's harness is pure functions only. Testing it needs `@testing-library/react` + jsdom, which
is a new dependency and a scope decision, not something to slip into a fix. Verified by `tsc` on both
configs, `npm run build` and 55/55 existing tests — **none of which exercise this hook.** The real
check is manual: open a pupil's chart and click prev/next rapidly, confirming the name above the
chart always matches the chart.

**Deliberately NOT bundled:** BUG-00 lives in this same hook (`myCharts.find` hiding later
chartings). It changes *what* is displayed where this changed *when* it is committed, and keeping
them in separate commits keeps any regression attributable.

**A note for BUG-08's sweep:** this fix inlines the pattern a third time. At three sites that is
right — extracting a shared helper for three call sites would be premature. **At the eight further
sites BUG-08 names, the extraction starts paying for itself**, and that is the moment to do it, not
now.

Original finding follows.

### BUG-07 (original) · HIGH
Claim:    **The dental chart can display one pupil's identity above another pupil's teeth.** This is
          not ordinary staleness — a *mixed* state is reachable, because the hook commits state at
          two different awaits.
Evidence: `reload` is a `useCallback` keyed `[studentId]`, run by an effect on `[reload]`, with **no
          cancellation guard**. Inside, it awaits a first `Promise.all` (student, schools, IPTRs,
          dentists) and then **immediately commits** `setStudent`, `setSchoolName`, `setDentists`. It
          then awaits a *second* `Promise.all` (seven joined collections) and commits `setYears`.
          With two runs in flight, this interleaving is reachable:
          `A-first → setStudent(A)` · `B-first → setStudent(B)` · `A-second → setYears(A)`
          — leaving **pupil B's name, school and dentist above pupil A's chart years.**
Impact:   The trigger is the ordinary way of working: `useStudentNav` puts prev/next patient buttons
          on this very screen, and paging through a class means clicking next repeatedly. The screen
          then shows a clinically wrong record that looks entirely normal — no error, no empty state.
          ⚠ **`useStudentNav` itself guards. The hook it navigates *with* does not.** The two sit on
          the same screen.
Fix:      Add the `isStale()` / `runIdRef` guard `useDohReportData` already uses — **and check it
          before BOTH commit points**, not just the last one. A guard only on `setYears` would still
          allow the mixed state.
⚠ This is also the hook carrying BUG-00 (`myCharts.find` hiding later chartings). **Fix them
  separately** — BUG-00 changes what is displayed, BUG-07 changes when it is committed, and bundling
  them makes a regression unattributable.

### BUG-08 · `src/app/hooks/` — 15 files · MED · OPEN
Claim:    The out-of-order guard is applied to 5 of 20 hooks, and several of the 15 without one fetch
          on inputs a user can flip quickly.
Evidence: **With a guard:** `useDohReportData`, `useSchoolSummary`, `useGradeRoster`,
          `useLiveNumbers`, `useStudentNav`.
          **Without, and genuinely at risk:** `useDentalChartData` `[studentId]` (BUG-07),
          `useAppointments` `[fromMs, toMs]` (calendar paging), `useFhsisData` `[month, schoolName]`,
          `useRPCTracking` `[key]`, `useRiskClassification` `[key]`, `useAuditTrail` `[fromKey]`,
          `useDayNotes` `[fromKey, toKey]`, `useNotifications` `[enabled, schoolName]`.
          **Without, and fine:** `useSchools`, `useUsers`, `useStudents` (fetch once on `[]`), and
          `useLoadPhase`, `usePrintOrientation`, `useOfflineQueue`, `useRefreshOnFocus` (not fetch
          hooks at all).
Impact:   Every one of the at-risk hooks feeds a screen with a school switcher, a month/period
          selector or a date range — the controls people click twice in a second. The failure is
          silent: the older response wins and the screen shows the previous selection's numbers under
          the new selection's label. CLAUDE.md's rule that a control which appears to work must work
          is exactly what this breaks.
Fix:      Apply the existing pattern. ⚠ **Not a mechanical sweep** — do it per hook, checking each
          commit point, and prefer doing it alongside whatever sprint already touches that hook.
Note:     **No hook uses `AbortController`.** The in-house guard discards a late *result*; it does not
          cancel the request. That is a reasonable trade (simpler, and these are small GETs) and is
          recorded so nobody reports it again as a separate finding — but it does mean a fast
          switcher still pays the bandwidth for every response it throws away.

### BUG-09 · `src/app/hooks/useAppointments.ts:206` · LOW · OPEN
Claim:    A `useMemo` never hits its cache, because one dependency changes identity on every render.
Evidence: `}, [appointments, students, schools, dentists, pendingWrites]);` — `pendingWrites` comes
          from `usePendingWritesFor`, which returns `queue.filter(...)`, **a new array every render**.
          The effect 23 lines above it gets this right: `}, [pendingWrites.length, reload]);`.
Impact:   `buildSessions` re-runs on every render of every screen using appointments. Wasted work, not
          wrong output — and small, since the collections are already bounded by the date window.
          Worth fixing mainly because the same file already demonstrates the correct form, so the
          inconsistency will confuse the next reader.
Fix:      Depend on `pendingWrites.length`, or memoise `pendingWrites` at its source.

---

### BUG-06 · `server/utils/schoolScope.ts:99-132` · MED · OPEN
**Found while fixing BUG-04 — the neighbouring case, deliberately not fixed with it.**
Claim:    **The scope walk ignores `isArchived` entirely**, so archiving a parent does not take its
          children out of circulation, and a write may still name an archived parent.
Evidence: All four walk functions gather ids with no archive filter:
          `Student.find({ school_id: { $in: schools } })`,
          `StudentIptr.find({ student_id: { $in: … } })`,
          `DentalChart.find({ iptr_id: { $in: … } })`,
          `PreventiveCareRecord.find({ iptr_id: { $in: … } })` — each `.select("_id").lean()`, none
          with `isArchived: false`.
Impact:   Two effects, and the first is the same family as BUG-04.
          **Writes:** `isInScope("ToothRecord", req, body)` returns true for a `chart_id` whose chart
          is archived, so a queued (or direct) `POST /tooth-records` can create a **live** tooth
          record under an **archived** chart. BUG-04 closed the edit-into-archived path; this is the
          create-under-archived one.
          **Reads:** a list route's base filter is `isArchived: false` on the CHILD only, so a live
          child of an archived parent still returns — archiving an IPTR does not hide its medical
          history, charts or tooth records from an `?iptr_id=` query.
          ⚠ Whether the read half is *wrong* is a genuine design question, not an obvious bug: the
          child record is itself live. It should be decided, not patched by reflex.
Fix:      needs scoping — and it is a **policy decision first**: does archiving a parent archive its
          children (a cascade, which nothing in the app does today), or merely hide them? Answer that
          before touching the walk.
Note:     While reading these: each walk is an unbounded whole-collection read, memoised per request.
          At the Chapter 1 scale `studentIds` pulls ~8,000 ids on every scoped request. Same family
          as SEC-24; only scoped users (`school_admin`) pay it, which is why it has not been noticed.

### BUG-05 · `src/app/offline/queueProcessor.ts` `checkForConflict` · LOW · OPEN (known limitation)
Claim:    Conflict detection is check-then-act, with a window between the GET and the PUT.
Evidence: `checkForConflict` GETs the record and compares against `baselineSnapshot`; `sendDirect`
          then PUTs. Another writer landing between the two is not detected.
Impact:   Small, and inherent — it cannot be closed on the client alone, because no model carries a
          version or updated-at token the server could check an `If-Match` against. Recorded so the
          conflict feature is not described as stronger than it is.
Fix:      Real optimistic locking needs a server-side version field. Not worth doing for its own
          sake; worth knowing if a version field is ever added for another reason.

### SEC-27 — CONFIRMED, and the mechanism is worse than "possible"
Sprint 156 established that queue rows carry no owner. Sprint 159 has the trigger: **`App.tsx:10-12`
calls `initQueueProcessor()` in a root `useEffect(…, [])`, OUTSIDE `AuthProvider`**, and
`initQueueProcessor` calls `processQueue()` immediately whenever `navigator.onLine`. The queue
therefore drains **on every app load**, before and regardless of any login check, using whatever
session cookie the browser currently holds (`credentials: 'include'`).

- **Nobody logged in** → 401 → refresh fails → `markAuthRequired` and stop. **Fails safe.**
- **A DIFFERENT user logged in** → the writes go through under *their* session, and
  `logAudit(req.user!.id, …)` records **them** as the author. This is the case that matters, and it
  needs no unusual timing — only the next person to sign in on that clinic PC.

Plus the SW's background-sync path, which runs with no page and no session context at all.
