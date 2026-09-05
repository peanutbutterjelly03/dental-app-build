import type { Request, Response } from "express";
import Student from "../models/Student.js";

/** What the client needs to show "is this the same child?" — deliberately a
 *  projection, not the whole record: the dialog only has to be recognisable. */
export interface DuplicateCandidate {
  _id: string;
  full_name: string;
  grade_level: string;
  section: string;
  sex: string;
  birthday: Date;
}

/** Lowercase, collapse internal whitespace, and fold accents so "Peña" and
 *  "Pena" match — the same child is regularly encoded both ways depending on
 *  whether the encoder's keyboard had the ñ. NFD splits the accent off as a
 *  combining mark, which \p{Mn} then strips. */
function normalizeName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Finds students who look like the one being created.
 *
 *  Match rule: same school + same birthday + same last and first name.
 *  `middle_name` is deliberately NOT part of the key — OCR drops it often
 *  enough that requiring it would miss the exact duplicates this is for. `sex`
 *  is likewise excluded (it is a common mis-entry) but is returned so the
 *  person deciding can see it.
 *
 *  Why this shape: name fields are encrypted with random IVs (Sprint 26), so a
 *  plaintext equality query on them NEVER matches. `birthday`, `school_id` and
 *  `isArchived` are unencrypted, so they do the narrowing in the database and
 *  only that handful of documents gets name-compared in JS. This keeps the
 *  check off the unbounded-read path even at the ~8,000-student scale.
 *
 *  Archived students are excluded: the dialog offers "Open existing", and an
 *  archived record 404s for everyone except System Admin, so warning about one
 *  would be a dead end for the clinical staff who do the encoding.
 */
export async function findDuplicateStudents(
  body: Record<string, unknown>,
): Promise<DuplicateCandidate[]> {
  const { school_id, birthday, last_name, first_name } = body;
  if (!school_id || !birthday || !last_name || !first_name) return [];

  const day = new Date(birthday as string);
  if (Number.isNaN(day.getTime())) return [];
  // Match the whole calendar day rather than an exact instant: birthdays
  // entered through different paths can carry a time component.
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // find() runs the decryption hook, so names are plaintext on these docs.
  const sameDay = await Student.find({
    school_id,
    isArchived: false,
    birthday: { $gte: dayStart, $lt: dayEnd },
  });

  const wantLast = normalizeName(last_name);
  const wantFirst = normalizeName(first_name);

  return sameDay
    .filter(
      (s: any) =>
        normalizeName(s.last_name) === wantLast &&
        normalizeName(s.first_name) === wantFirst,
    )
    .map((s: any) => ({
      _id: s._id.toString(),
      full_name: s.full_name,
      grade_level: s.grade_level,
      section: s.section,
      sex: s.sex,
      birthday: s.birthday,
    }));
}

/** Housekeeping scan over ALL already-saved active students, grouping ones
 *  that look like the same child encoded more than once — unlike
 *  `findDuplicateStudents` above, which only checks one incoming record
 *  against existing ones at create time. Match key: normalized last + first
 *  name, birthday (calendar day), and sex. Sex IS part of the key here
 *  (unlike the create-time check, which excludes it as a common mis-entry) —
 *  a false positive here is just a review row, not a blocked save, so the
 *  narrower key is the right trade-off: it surfaces the classic "the same
 *  child was encoded twice" case without also flagging misspelled-sex typos
 *  as a name-and-birthday coincidence.
 *
 *  Same encryption reasoning as findDuplicateStudents: name fields only
 *  decrypt through `find()`'s hook, so the comparison happens in JS after an
 *  unencrypted-field-only query narrows the read. Scoped to one school by
 *  default to keep that read bounded — pass no school_id only for a
 *  System-Admin-style cross-school scan. */
export async function findDuplicateGroups(schoolId?: string): Promise<DuplicateCandidate[][]> {
  const query: Record<string, unknown> = { isArchived: false };
  if (schoolId) query.school_id = schoolId;
  const students = await Student.find(query);

  const groups = new Map<string, any[]>();
  for (const s of students as any[]) {
    if (!s.birthday) continue;
    const day = new Date(s.birthday);
    if (Number.isNaN(day.getTime())) continue;
    const dayKey = day.toISOString().slice(0, 10);
    const key = `${normalizeName(s.last_name)}|${normalizeName(s.first_name)}|${dayKey}|${String(s.sex ?? "").toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) =>
      list.map((s) => ({
        _id: s._id.toString(),
        full_name: s.full_name,
        grade_level: s.grade_level,
        section: s.section,
        sex: s.sex,
        birthday: s.birthday,
      })),
    );
}

export async function getDuplicateStudents(req: Request, res: Response) {
  const schoolId = typeof req.query.school_id === "string" ? req.query.school_id : undefined;
  const groups = await findDuplicateGroups(schoolId);
  res.json(groups);
}
