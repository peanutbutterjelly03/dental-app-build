export type ApiRole = "system_admin" | "dentist" | "dental_aide" | "school_admin" | "bho_staff";

export interface ApiUser {
  _id: string;
  /** Empty means ALL schools (Sprint 100). */
  school_ids: string[];
  role: ApiRole;
  full_name: string;
  email: string;
  is_enrolled: boolean;
  last_login: string | null;
  twofa_enabled?: boolean;
  isArchived: boolean;
}

export interface ApiSchool {
  _id: string;
  school_name: string;
  school_type: string;
  /** Her feature, carried across with UpdateSchoolYear (Sprint 157). ⚠ NOT on
   *  our SCHOOL model yet, so it reads undefined and the dialog's manual
   *  override section stays hidden — the dialog's real job, rolling the year
   *  forward, is unaffected. Wiring it needs a model field AND a toggle in
   *  School Management; until then nothing on screen claims it works. */
  allow_school_year_override?: boolean;
  /** All required by the School model; the admin registry form writes them.
   *  Optional here only because older callers select a subset of fields. */
  principal_name?: string;
  street_address?: string;
  barangay?: string;
  city?: string;
  isArchived: boolean;
}

export interface ApiStudent {
  _id: string;
  school_id: string;
  /** Derived server-side from the name parts below; kept for display/compat. */
  full_name: string;
  last_name: string;
  first_name: string;
  middle_name?: string;
  birthday: string;
  /** '' when is_not_student is true -- required otherwise. */
  sex: string;
  address: string;
  contact_number?: string;
  /** '' when is_not_student is true -- required otherwise. */
  grade_level: string;
  /** '' when is_not_student is true -- required otherwise. */
  section: string;
  /** Added 2026-09-25. A person recorded through Add Student who isn't
   *  actually enrolled (sibling/community member treated at a mission) --
   *  sex/grade_level/section are absent for these. Optional since records
   *  created before this field existed have no value. */
  is_not_student?: boolean;
  place_of_birth?: string;
  guardian_occupation?: string;
  guardian_name?: string;
  guardian_contact?: string;
  philhealth_number?: string;
  philhealth_status?: 'None' | 'Principal' | 'Dependent';
  is_4ps?: boolean;
  fourps_id?: string;
  consent_status: "pending" | "complete";
  isArchived: boolean;
}

export interface ApiStudentIptr {
  _id: string;
  student_id: string;
  school_year: string;
  /** The grade and section the student was in FOR THIS SCHOOL YEAR (Sprint
   *  57a). Null on records created before the change — there is no truthful
   *  value to backfill for an old year, so year-scoped views say "not
   *  recorded" rather than falling back to today's grade, which is the exact
   *  bug this replaced. STUDENT keeps its own grade_level/section as the
   *  CURRENT values. */
  grade_level: string | null;
  section: string | null;
  /** Measured for THIS school year. BMI is derived from them, never stored. */
  height_cm: number | null;
  weight_kg: number | null;
  isArchived: boolean;
  temperature_c?: number | null;
  blood_pressure?: string | null;
  /** Consent for THIS school year (Sprint 167). A guardian signs each year. */
  consent_status: 'pending' | 'complete';
  /** Server-set when consent_status becomes 'complete'; null while pending. */
  consent_given_at?: string | null;
}

export interface ApiDentalChart {
  _id: string;
  iptr_id: string;
  dentist_id: string;
  date_charted: string;
  /** The RPC visit this charting was done at (Sprint 149), or null for a
   *  charting with no visit attached — including every chart created before
   *  that sprint. */
  preventive_id?: string | null;
  isArchived: boolean;
}

export interface ApiToothRecord {
  _id: string;
  chart_id: string;
  tooth_number: number;
  condition: string;
  treatment_code?: string;
}

export interface ApiPreventiveCareRecord {
  _id: string;
  iptr_id: string;
  visit_date: string;
  visit_number: 1 | 2;
  /** Facility-based care (FHSIS Section D sub-row `a`) vs non-facility-based
   *  (`b`). NULL means not recorded — every record created before Sprint 81 is
   *  null, and those stay out of both sub-rows rather than being guessed into
   *  one. See PreventiveCareRecord.ts for why the default is null, not false. */
  facility_based: boolean | null;
  /** The services performed AT this visit (Sprint 147). ⚠ NULL means NOT
   *  RECORDED, never "not done" — every visit created before that sprint has
   *  no answer, and a form must not claim a service was withheld. */
  oral_screening?: boolean | null;
  oral_prophylaxis?: boolean | null;
  fluoride_varnish?: boolean | null;
  oral_hygiene_instruction?: boolean | null;
  /** Added 2026-09-25, same null-means-not-recorded rule as the four above.
   *  Not a DOH Target Client List column -- tracked for the clinic's own
   *  record only. */
  consultation?: boolean | null;
  /** The form's own words — it prints Moderate where RISK_STRATIFICATION says
   *  Medium. On the form, the form wins. */
  caries_risk?: 'Low' | 'Moderate' | 'High' | null;
}

export interface ApiRiskStratification {
  _id: string;
  preventive_id: string;
  risk_level: "High" | "Medium" | "Low";
  recommendation: string;
  dmf_score: number;
  dmf_index: "DMF" | "dmf";
  validated_by_dentist: boolean;
  validated_at: string | null;
}

export interface ApiMedicalHistory {
  _id: string;
  iptr_id: string;
  allergies: string;
  diabetes_mellitus: boolean;
  hypertension: boolean;
  cardiovascular_disease: boolean;
  thyroid_disorders: boolean;
  hepatitis_disorders: boolean;
  malignancy: boolean;
  previous_hospitalization: boolean;
  previous_surgical: boolean;
  blood_transfusion: boolean;
  tattoo: boolean;
  others: string;
}

export interface ApiDietarySocialHabits {
  _id: string;
  iptr_id: string;
  sugar_beverages: boolean;
  alcohol_drinker: boolean;
  tobacco_user: boolean;
  betel_nut_chewer: boolean;
  body_piercing: boolean;
  nail_biting: boolean;
  thumb_sucking: boolean;
}

export interface ApiOralHealthCondition {
  _id: string;
  iptr_id: string;
  oral_hygiene: string;
  gingivitis: boolean;
  periodontal_disease: boolean;
  debris: boolean;
  calculus: boolean;
  abnormal_growth: boolean;
  cleft_lip_palate: boolean;
  /** Added 2026-09-25. The dentist's own judgment call, not derived. Optional
   *  since records created before this field existed have no value. */
  orally_fit_child?: boolean;
  others: string;
}

export interface ApiTreatment {
  _id: string;
  iptr_id: string;
  dentist_id: string;
  diagnosis: string;
  treatment_done: string;
  remarks: string;
  date: string;
  isArchived: boolean;
}

// Sprint 127. `referral_type` is the DOH Program Report's own row list — see
// server/models/Referral.ts for which enum value fills which printed row.
export type ReferralType =
  | 'primary_care'
  | 'higher_level'
  | 'oral_cancer_screening'
  | 'surgical'
  | 'private_facility';

export interface ApiReferral {
  _id: string;
  iptr_id: string;
  dentist_id: string | null;
  referral_type: ReferralType;
  date_issued: string;
  facility_name: string;
  reason: string;
  notes: string;
  status: 'pending' | 'completed' | 'no-show';
  follow_up_date: string | null;
  isArchived: boolean;
}

export interface ApiDentist {
  _id: string;
  school_id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  license_number: string;
}

export interface ApiAppointment {
  _id: string;
  student_id: string;
  dentist_id: string;
  appointment_datetime: string;
  status: string;
  appointment_type: string;
  requires_followup: boolean;
  parental_supervision_required: boolean;
  /** Added 2026-09-25. Required on new bookings; absent on records created before then. */
  guardian_contact_number?: string;
  /** Per-appointment remark (Sprint 109). Empty string when unset. */
  notes?: string;
  isArchived: boolean;
}

// ApiDentistRotation was removed 2026-09-07 with the Rotation tab. The
// DENTIST_ROTATION model and `/dentist-rotations` still exist server-side and
// any saved rows are untouched — nothing in the UI reads them. Re-derive this
// type from `server/models/DentistRotation.ts` if the schedule is ever built.

export interface ApiAuditTrail {
  _id: string;
  user_id: string;
  action: string;
  timestamp: string;
  affected_record_id: string;
  affected_model: string;
}
