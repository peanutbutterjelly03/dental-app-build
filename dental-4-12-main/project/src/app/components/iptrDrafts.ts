// The IPTR form's DRAFT SHAPES — the in-progress edit state for the three
// per-school-year records the chart screen writes: MEDICAL_HISTORY,
// DIETARY_SOCIAL_HABITS and ORAL_HEALTH_CONDITION.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged. These are shared
// rather than owned by one tab: the History tab edits medical and dietary, the
// Dental Chart tab edits oral (moved there in Sprint 176, because that is where
// a clinician is looking when they notice calculus), and the host holds all
// three because it owns the save.
//
// ⚠ They live here rather than being exported from a tab component so that
// nothing has to import from the 2,800-line host — the coupling Sprint 162a
// removed for the code tables, for the same reason.
//
// ⚠ Each `empty*` is a FUNCTION, not a shared object literal. A single shared
// default would be mutated by the first form that edits it and then handed to
// the next pupil.

/** MEDICAL_HISTORY's yes/no questions, by their API field name. Ticked =
 *  true ("Oo" on Form 1), unticked = false ("Hindi"). */
export const MED_FLAGS = [
  'hypertension', 'diabetes_mellitus', 'blood_disorders', 'cardiovascular_disease', 'thyroid_disorders',
  'hepatitis_disorders', 'malignancy', 'previous_hospitalization', 'previous_surgical', 'blood_transfusion', 'tattoo',
  'liver_disease', 'anemia', 'anesthesia_allergy', 'previous_extraction', 'extraction_bleeding',
  'chest_tightness', 'asthma', 'menstruation', 'pregnant', 'current_medication', 'epilepsy', 'high_blood_pressure',
] as const;
export type MedFlag = typeof MED_FLAGS[number];
/** The free-text details, also by API field name. */
export const MED_TEXTS = [
  'allergies', 'others', 'hepatitis_type', 'malignancy_details', 'blood_transfusion_date', 'last_admission', 'medication_details',
  'last_extraction_date', 'surgical_details',
] as const;
export type MedText = typeof MED_TEXTS[number];
export type MedicalHistoryDraft = Record<MedFlag, boolean> & Record<MedText, string>;
export type DietDraft = {
  sugarSweetened: boolean; alcoholDrinker: boolean; tobaccoUser: boolean; betelNut: boolean;
  bodyPiercing: boolean; nailBiting: boolean; thumbsucking: boolean;
};
export type OralDraft = {
  gingivitis: boolean; periodontal: boolean; debris: boolean; calculus: boolean;
  abnormalGrowth: boolean; cleftLipPalate: boolean; oralHygiene: string; others: string;
};

/** Physical measurements, held as STRINGS while being typed — an empty input is
 *  '' and must not become 0, which would record a real measurement of zero. */
export type MeasureDraft = {
  height_cm: string; weight_kg: string; temperature_c: string; blood_pressure: string;
};

export const emptyMed = (): MedicalHistoryDraft => ({
  ...(Object.fromEntries(MED_FLAGS.map((f) => [f, false])) as Record<MedFlag, boolean>),
  ...(Object.fromEntries(MED_TEXTS.map((f) => [f, ''])) as Record<MedText, string>),
});
/** Draft from a stored record: the same field names, so no translation table
 *  to drift. A field the record predates reads as unticked / empty. */
export const medDraftFrom = (mh: Partial<Record<MedFlag, boolean | null> & Record<MedText, string>>): MedicalHistoryDraft => ({
  ...(Object.fromEntries(MED_FLAGS.map((f) => [f, mh[f] === true])) as Record<MedFlag, boolean>),
  ...(Object.fromEntries(MED_TEXTS.map((f) => [f, mh[f] ?? ''])) as Record<MedText, string>),
});
export const emptyDiet = (): DietDraft => ({
  sugarSweetened: false, alcoholDrinker: false, tobaccoUser: false, betelNut: false,
  bodyPiercing: false, nailBiting: false, thumbsucking: false,
});
export const emptyOral = (): OralDraft => ({
  gingivitis: false, periodontal: false, debris: false, calculus: false,
  abnormalGrowth: false, cleftLipPalate: false, oralHygiene: '', others: '',
});
