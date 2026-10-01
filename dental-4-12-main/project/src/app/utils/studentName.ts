// The name helpers live in `shared/` so the server's endpoints and this app use
// ONE implementation (Sprint 139) — re-exported here so every existing import
// of '../utils/studentName' keeps working.
export { surnameFirst, surnameFirstWithInitial, surnameOnly } from '../../../shared/studentName';
export type { NameParts } from '../../../shared/studentName';
