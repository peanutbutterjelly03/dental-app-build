export const ALL_ROLES = ["system_admin", "dentist", "dental_aide", "school_admin", "bho_staff"];
export const CLINICAL_WRITE_ROLES = ["system_admin", "dentist", "dental_aide"];
export const ADMIN_ONLY = ["system_admin"];
// Sprint 163 (SEC-19): clinical records are READ by the clinic and the System
// Admin only. Chapter 1: the School Administrator "views school reports and
// dashboards only, no clinical records"; BHO staff work from reports.
export const CLINICAL_READ_ROLES = ["system_admin", "dentist", "dental_aide"];
// Part B (user decision 2026-09-29): BHO staff KEEP the named Target Client List
// and Consent Form, which read these three collections; the School Admin does not.
export const CLINICAL_READ_ROLES_AND_BHO = [...CLINICAL_READ_ROLES, "bho_staff"];
// Sprint 163 (SEC-03): roles that see counts, never a pupil's name.
export const NAME_BLIND_ROLES = ["school_admin"];
