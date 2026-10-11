// The age brackets live in `shared/` so the server's filters use the SAME ones
// (Sprint 145) — re-exported here so every existing import keeps working.
export { calculateAge, getAgeGroup, AGE_GROUPS } from '../../../shared/age';
