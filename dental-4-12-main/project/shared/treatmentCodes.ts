// The dental chart's TREATMENT CODE vocabulary — moved out of
// `src/app/utils/dentalChartCodes.ts` into `shared/` (user, 2026-09-27) so
// the server can import the exact same list. The Treatment Records category
// cards need to bucket students by these codes server-side (ToothRecord.
// treatment_code for the per-tooth ones, PreventiveCareRecord's boolean
// fields for the whole-mouth ones) — duplicating this array in the route
// would drift from the client's own palette the moment either changed.
// `dentalChartCodes.ts` re-exports everything below unchanged, so no
// existing client import site had to move.

// Base44-exact treatment codes
// `local` is the word the clinic and the families actually use. The clinical
// term stays primary — DOH forms and the manuscript use it — and the local term
// is shown beside it so staff reading a screen mid-appointment, and a parent
// looking over their shoulder, both recognise the service. "Pasta" was already
// carried on TR before this; the rest were added 2026-09-02.
//
// ⚠ Only terms the dentist confirms should live here. A wrong local word on a
// clinical screen is worse than none — leave `local` off rather than guess.
export const treatmentCodes = [
  { code: 'OEX', label: 'Oral Exam / Checkup', local: 'Tingin' },
  { code: 'FV', label: 'Fluoride Varnish' },
  { code: 'PFS', label: 'Pit and Fissure Sealant' },
  { code: 'OP', label: 'Oral Prophylaxis', local: 'Linis' },
  { code: 'PF', label: 'Permanent Filling', local: 'Pasta' },
  { code: 'TF', label: 'Temporary Filling', local: 'Pansamantalang pasta' },
  { code: 'TR', label: 'Tooth Restoration', local: 'Pasta' },
  { code: 'X', label: 'Extraction', local: 'Bunot' },
  { code: 'SDF', label: 'Silver Diamine Fluoride' },
  { code: 'CONS', label: 'Consultation' },
];

// The three codes that describe the whole mouth, not a tooth. They have their
// own rows in the Treatment Summary, above the per-tooth table — her split.
//
// ⚠ A code listed here still appears in the per-tooth table WHEN TEETH ARE
// CHARTED WITH IT. The palette allows it, so filtering blindly would make a
// charted FV vanish from the summary; a summary that hides a charted tooth is
// worse than one row too many.
// CONS added 2026-09-25 (user decision): consultation is whole-mouth, not a
// per-tooth finding, same reasoning as OEX/FV/OP -- and unlike Treatments
// Given's chips (which write to PREVENTIVE_CARE_RECORD, an RPC visit), this
// is deliberately NOT tied to RPC. It is just another treatment code, so it
// is charted and read back the same way as everything else in this list.
export const WHOLE_MOUTH_TREATMENT_CODES = ['OEX', 'FV', 'OP', 'CONS'];

// The palette's two rows (Sprint 156). Per-tooth codes lead; the whole-mouth
// three sit behind "More" rather than being dropped, so an FV already charted
// on a tooth by an older record can still be changed or cleared.
export const perToothTreatmentCodes = treatmentCodes.filter((t) => !WHOLE_MOUTH_TREATMENT_CODES.includes(t.code));
export const wholeMouthTreatmentCodes = treatmentCodes.filter((t) => WHOLE_MOUTH_TREATMENT_CODES.includes(t.code));

/** "Extraction (Bunot)" where a local term exists, otherwise just the label. */
export const treatmentLabel = (t: { label: string; local?: string }) =>
  t.local ? `${t.label} (${t.local})` : t.label;

// Server-side mapping from a whole-mouth treatment code to the
// PreventiveCareRecord boolean field that records it (user, 2026-09-27, for
// /stats/treatment-categories). "OEX" (Oral Exam/Checkup) reads as
// `oral_screening` on that record -- same field DentalChart.tsx's own
// "Oral Examination" service chip writes to (see ServiceField in
// DentalChart.tsx). Oral Hygiene Instruction has no treatment code (it isn't
// in `treatmentCodes` above) and is intentionally not a category here.
export const WHOLE_MOUTH_CODE_TO_PREVENTIVE_FIELD: Record<string, 'oral_screening' | 'oral_prophylaxis' | 'fluoride_varnish' | 'consultation'> = {
  OEX: 'oral_screening',
  FV: 'fluoride_varnish',
  OP: 'oral_prophylaxis',
  CONS: 'consultation',
};
