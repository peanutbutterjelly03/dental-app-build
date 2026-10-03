import { Router } from "express";
import mongoose, { type Model } from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAudit } from "../utils/auditLog.js";
import { ALL_ROLES, ADMIN_ONLY } from "../middleware/roleGroups.js";

const PROTECTED_FIELDS = [
  "_id", "isArchived", "archivedAt", "archivedBy", "created_at", "updated_at",
  "password_hash",
  // 2FA/reset fields are managed only by their dedicated endpoints
  "twofa_enabled", "otp_hash", "otp_expires", "reset_token_hash", "reset_token_expires",
];

function sanitizeBody(body: Record<string, unknown>) {
  const clean = { ...body };
  for (const field of PROTECTED_FIELDS) delete clean[field];
  return clean;
}

// mongoose-field-encryption leaves encrypted fields as ciphertext on the in-memory
// document after create()/save() (decryption only happens on read via post('init')).
// Decrypt in place before sending the response, without touching the DB.
function decryptForResponse(doc: any) {
  if (typeof doc.decryptFieldsSync === "function") doc.decryptFieldsSync();
  return doc;
}

interface CrudOptions {
  readOnly?: boolean;
  readRoles?: string[];
  writeRoles?: string[];
  archiveRoles?: string[];
  /** Who may un-archive. Split from archiveRoles so a model can let clinical
   *  staff archive their own records while restore stays System Admin only,
   *  per the soft-delete rule in CLAUDE.md. */
  restoreRoles?: string[];
  /** Override the create audit action string from the request body (e.g.
   *  RISK_STRATIFICATION records whether the dentist accepted or changed the
   *  AI suggestion). Return undefined to keep the default "Created X". */
  auditCreateAction?: (body: Record<string, unknown>) => string | undefined;
  /** Reject a POST that would duplicate an existing record on these fields.
   *  Added 2026-08-11 after a double-submit on "Add Year" created two
   *  StudentIptr rows for one school year a second apart, which surfaced as a
   *  repeated year in the DMFT History table and an inflated "Years tracked".
   *  Guards every client, not just the button that caused it. */
  uniqueBy?: string[];
  /** Soft duplicate guard — the "doctor can choose" case (Sprint 47). Unlike
   *  `uniqueBy`, which is a hard 409 the client cannot override, this returns
   *  the likely matches so the user decides: open the existing record, or
   *  confirm this really is a different person and save anyway.
   *
   *  It is a callback rather than a field list because STUDENT names are
   *  encrypted with random IVs (Sprint 26) — no server-side equality query can
   *  ever find them. The callback prefilters on plaintext fields and compares
   *  decrypted values in JS.
   *
   *  Living here rather than in one form's submit handler means every entry
   *  path is covered by one rule: the add form, bulk import, OCR, and offline
   *  replay. Returning a non-empty array answers 409 with the candidates,
   *  unless the request body carries `confirm_duplicate: true`. */
  duplicateCheck?: (body: Record<string, unknown>) => Promise<unknown[]>;
  /** Foreign-key fields that GET / may be filtered by, e.g. `?iptr_id=abc` or
   *  `?iptr_id=abc,def` for several at once (Sprint 48).
   *
   *  Why this exists: every list hook used to fetch a WHOLE collection and
   *  filter it in the browser. Showing one student's chart pulled every IPTR,
   *  medical history, chart and tooth record in the database to find ~3 rows —
   *  measured at 14-58 MB per open at the 8,000-student scale.
   *
   *  Strictly a WHITELIST, and deliberately ObjectId-only: these are all
   *  unencrypted foreign keys, so plaintext equality works on them (unlike the
   *  encrypted fields, which random IVs put out of reach — see CLAUDE.md).
   *  Anything not listed here, or not a valid ObjectId, is rejected rather
   *  than passed through to the query. */
  filterable?: string[];
  /** Unencrypted STRING fields GET / may be filtered by, e.g.
   *  `?grade_level=Grade 5&section=Sampaguita` (Sprint 56).
   *
   *  Split from `filterable` rather than folded into it because that one is
   *  deliberately ObjectId-only — its validation IS `isValidObjectId`, which is
   *  the whole reason a crafted value cannot reach the query. These are plain
   *  equality matches on plaintext columns, so they get their own whitelist and
   *  their own length cap.
   *
   *  NEVER list an encrypted field here: random IVs (Sprint 26) mean a
   *  server-side equality match can never succeed, so it would silently return
   *  nothing rather than fail loudly. */
  filterableText?: string[];
  /** Date field GET / may be bounded on, via `?from=` / `?to=` (ISO instants).
   *
   *  Exists because APPOINTMENT has no `school_year` and no per-year parent the
   *  way STUDENT_IPTR does, so a date range is its only natural boundary. Left
   *  unbounded, the Completed and Missed tabs accumulate every appointment ever
   *  created, forever — nothing is hard deleted, so nothing ever leaves them.
   *
   *  Both bounds are inclusive and compared as instants, so the caller decides
   *  what "end of day" means rather than this layer guessing at a timezone.
   *  Opt-in per model: no existing list route changes shape without being
   *  given this option. */
  dateField?: string;
}

/** Cap on a text filter value. Long enough for any real grade or section name,
 *  short enough that a filter value cannot become a payload. */
const MAX_TEXT_FILTER_LEN = 100;

/** Max ids accepted in one comma-separated filter. A student with more school
 *  years than this does not exist; the cap is here so a crafted query cannot
 *  turn into an unbounded `$in`. */
const MAX_FILTER_IDS = 200;

export function createCrudRouter(model: Model<any>, options: CrudOptions = {}) {
  const router = Router();
  const hasSoftDelete = !!model.schema.path("isArchived");
  const readOnly = options.readOnly === true;
  const readRoles = options.readRoles ?? ALL_ROLES;
  const writeRoles = options.writeRoles ?? ADMIN_ONLY;
  const archiveRoles = options.archiveRoles ?? ADMIN_ONLY;
  const restoreRoles = options.restoreRoles ?? ADMIN_ONLY;
  const modelName = model.modelName;

  router.get(
    "/",
    requireAuth,
    requireRole(...readRoles),
    asyncHandler(async (req, res) => {
      const wantsArchived = req.query.includeArchived === "true";
      if (wantsArchived && !ADMIN_ONLY.includes(req.user!.role)) {
        res.status(403).json({ error: "Only System Admin can view archived records" });
        return;
      }
      const filter: Record<string, unknown> = hasSoftDelete && !wantsArchived ? { isArchived: false } : {};
      for (const field of options.filterable ?? []) {
        const raw = req.query[field];
        if (raw === undefined) continue;
        if (typeof raw !== "string") {
          res.status(400).json({ error: `Invalid ${field} filter` });
          return;
        }
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0 || ids.length > MAX_FILTER_IDS || !ids.every((id) => mongoose.isValidObjectId(id))) {
          res.status(400).json({ error: `Invalid ${field} filter` });
          return;
        }
        filter[field] = ids.length === 1 ? ids[0] : { $in: ids };
      }
      for (const field of options.filterableText ?? []) {
        const raw = req.query[field];
        if (raw === undefined) continue;
        if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TEXT_FILTER_LEN) {
          res.status(400).json({ error: `Invalid ${field} filter` });
          return;
        }
        filter[field] = raw;
      }
      if (options.dateField) {
        const range: Record<string, Date> = {};
        for (const [param, op] of [["from", "$gte"], ["to", "$lte"]] as const) {
          const raw = req.query[param];
          if (raw === undefined) continue;
          if (typeof raw !== "string") {
            res.status(400).json({ error: `Invalid ${param} filter` });
            return;
          }
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) {
            res.status(400).json({ error: `Invalid ${param} filter` });
            return;
          }
          range[op] = parsed;
        }
        if (Object.keys(range).length > 0) filter[options.dateField] = range;
      }
      const docs = await model.find(filter);
      res.json(docs);
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    requireRole(...readRoles),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const doc = await model.findById(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      // Archived records are only visible to System Admin — 404 (not 403) for
      // everyone else so their existence isn't leaked.
      if (hasSoftDelete && (doc as any).isArchived && !ADMIN_ONLY.includes(req.user!.role)) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(doc);
    }),
  );

  if (readOnly) return router;

  router.post(
    "/",
    requireAuth,
    requireRole(...writeRoles),
    asyncHandler(async (req, res) => {
      const body = sanitizeBody(req.body);
      // Not a stored field — it is the caller's answer to a previous 409, so
      // it must never reach model.create().
      const duplicateConfirmed = body.confirm_duplicate === true;
      delete body.confirm_duplicate;
      if (options.uniqueBy && options.uniqueBy.every((f) => body[f] !== undefined)) {
        const filter: Record<string, unknown> = {};
        for (const f of options.uniqueBy) filter[f] = body[f];
        // Only LIVE records block a create. This used to count archived ones
        // too, to stop a later restore resurrecting a duplicate — but that
        // made archiving worse than deleting: an IPTR recorded against the
        // wrong pupil and archived left that pupil+year permanently
        // uncreatable, 409-ing against a record the UI cannot even show.
        // The restore route below now carries that check instead, which is
        // where the conflict is visible and an admin can actually resolve it.
        const existing = await model.findOne({ ...filter, isArchived: false }).lean();
        if (existing) {
          res.status(409).json({ error: `A ${modelName} already exists for that ${options.uniqueBy.join(" + ")}` });
          return;
        }
      }
      if (options.duplicateCheck && !duplicateConfirmed) {
        const matches = await options.duplicateCheck(body);
        if (matches.length > 0) {
          res.status(409).json({
            error: `This looks like a ${modelName} that is already recorded.`,
            duplicates: matches,
          });
          return;
        }
      }
      const doc = await model.create(body);
      const action = options.auditCreateAction?.(req.body) ?? `Created ${modelName}`;
      await logAudit(req.user!.id, action, doc._id.toString(), modelName);
      res.status(201).json(decryptForResponse(doc));
    }),
  );

  router.put(
    "/:id",
    requireAuth,
    requireRole(...writeRoles),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      // Loads + mutates + .save() rather than findByIdAndUpdate: the latter's
      // pre('findOneAndUpdate') hook in mongoose-field-encryption has a bug that
      // corrupts encrypted fields and crashes on the next decrypt (calls a removed
      // Node crypto API). save() goes through the working pre('save') hook instead.
      const doc = await model.findById(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      Object.assign(doc, sanitizeBody(req.body));
      await doc.save();
      await logAudit(req.user!.id, `Updated ${modelName}`, (doc._id as any).toString(), modelName);
      res.json(decryptForResponse(doc));
    }),
  );

  if (hasSoftDelete) {
    router.patch(
      "/:id/archive",
      requireAuth,
      requireRole(...archiveRoles),
      asyncHandler(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
          res.status(400).json({ error: "Invalid id" });
          return;
        }
        const doc = await model.findByIdAndUpdate(
          req.params.id,
          { isArchived: true, archivedAt: new Date(), archivedBy: req.user!.id },
          { new: true },
        );
        if (!doc) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        await logAudit(req.user!.id, `Archived ${modelName}`, (doc._id as any).toString(), modelName);
        res.json(doc);
      }),
    );

    router.patch(
      "/:id/restore",
      requireAuth,
      requireRole(...restoreRoles),
      asyncHandler(async (req, res) => {
        if (!mongoose.isValidObjectId(req.params.id)) {
          res.status(400).json({ error: "Invalid id" });
          return;
        }
        // The create guard deliberately ignores archived records, so the
        // uniqueness conflict can only surface here: while this one sat
        // archived, a live record may have taken its student_id + school_year.
        // Restoring anyway would leave two live records sharing a key that is
        // supposed to be unique, and every read that assumes one would pick
        // arbitrarily between them.
        if (options.uniqueBy) {
          const archived: any = await model.findById(req.params.id).lean();
          if (!archived) {
            res.status(404).json({ error: "Not found" });
            return;
          }
          if (options.uniqueBy.every((f) => archived[f] !== undefined && archived[f] !== null)) {
            const filter: Record<string, unknown> = { isArchived: false };
            for (const f of options.uniqueBy) filter[f] = archived[f];
            const clash = await model.findOne(filter).lean();
            if (clash) {
              res.status(409).json({
                error: `Cannot restore: another ${modelName} is already active for that ${options.uniqueBy.join(" + ")}. Archive that one first.`,
              });
              return;
            }
          }
        }
        const doc = await model.findByIdAndUpdate(
          req.params.id,
          { isArchived: false, archivedAt: null, archivedBy: null },
          { new: true },
        );
        if (!doc) {
          res.status(404).json({ error: "Not found" });
          return;
        }
        await logAudit(req.user!.id, `Restored ${modelName}`, (doc._id as any).toString(), modelName);
        res.json(doc);
      }),
    );
  }

  return router;
}
