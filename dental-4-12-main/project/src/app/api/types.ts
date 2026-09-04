export type ApiRole = "system_admin" | "dentist" | "dental_aide" | "school_admin" | "bho_staff";

export interface ApiUser {
  _id: string;
  school_id: string | null;
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
  /** All required by the School model; the admin registry form writes them.
   *  Optional here only because older callers select a subset of fields. */
  principal_name?: string;
  street_address?: string;
  barangay?: string;
  city?: string;
  /** System Admin-only override: lets Update School Year's "Start New
   *  School Year" run outside its normal March-August window. */
  allow_school_year_override?: boolean;
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
  sex: string;
  address: string;
  contact_number?: string;
  grade_level: string;
  section: string;
  place_of_birth?: string;
  guardian_name?: string;
  guardian_contact?: string;
  guardian_occupation?: string;
  philhealth_number?: string;
  philhealth_status?: 'None' | 'Principal' | 'Dependent';
  is_4ps?: boolean;
  fourps_id?: string;
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
  /** Consent for THIS school year — renewed annually, not a lifetime flag.
   *  Moved off STUDENT for the same reason grade_level did (see above): one
   *  signature does not authorize every year that follows it. */
  consent_status: "pending" | "complete";
  /** Set server-side the moment consent_status becomes "complete"; null again
   *  the moment it reverts to "pending". Never client-supplied. */
  consent_given_at: string | null;
  isArchived: boolean;
}

export interface ApiDentalChart {
  _id: string;
  iptr_id: string;
  dentist_id: string;
  date_charted: string;
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
  others?: string;
}

export interface ApiOralHealthCondition {
  _id: string;
  iptr_id: string;
  oral_hygiene: string;
  orally_fit_child?: boolean;
  gingivitis: boolean;
  periodontal_disease: boolean;
  debris: boolean;
  calculus: boolean;
  abnormal_growth: boolean;
  cleft_lip_palate: boolean;
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
  isArchived: boolean;
}

export interface ApiDentistRotation {
  _id: string;
  school_id: string;
  dentist_id: string;
  week_start: string;
  week_end: string;
  notes: string;
}

export interface ApiAuditTrail {
  _id: string;
  user_id: string;
  action: string;
  timestamp: string;
  affected_record_id: string;
  affected_model: string;
}
