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

export type MedicalHistoryDraft = {
  allergies: string; hypertension: boolean; diabetes: boolean; bloodDisorders: boolean;
  cardiovascular: boolean; thyroid: boolean; hepatitis: boolean; malignancy: boolean;
  hospitalization: boolean; bloodTransfusion: boolean; tattoo: boolean; others: string;
};
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
  allergies: '', hypertension: false, diabetes: false, bloodDisorders: false, cardiovascular: false,
  thyroid: false, hepatitis: false, malignancy: false, hospitalization: false, bloodTransfusion: false,
  tattoo: false, others: '',
});
export const emptyDiet = (): DietDraft => ({
  sugarSweetened: false, alcoholDrinker: false, tobaccoUser: false, betelNut: false,
  bodyPiercing: false, nailBiting: false, thumbsucking: false,
});
export const emptyOral = (): OralDraft => ({
  gingivitis: false, periodontal: false, debris: false, calculus: false,
  abnormalGrowth: false, cleftLipPalate: false, oralHygiene: '', others: '',
});
