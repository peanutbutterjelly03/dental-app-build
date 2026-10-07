// Copy for the public pages. Facts only, taken from the project spec: no counts of
// students or visits, no statistics. Anything numeric that is not a fixed fact of
// the system (3 schools, 5 roles, 7 modules, 2 RPC visits) comes from the database
// after sign-in, never from here.

export const MODULES = [
  { key: 'Account access', d: 'Five roles with strict permissions. Each person sees only what their job needs.', b: ['System Admin, Dentist, Dental Aide, School Administrator, Barangay Health Office Staff', 'Secure sign-in, with the role checked on every request', 'Every addition, edit and archive is in the audit trail'] },
  { key: 'Student records', d: 'The digital IPTR: registration, medical history, dietary and social habits, oral health conditions.', b: ['Scan the paper IPTR and review the extracted fields before saving', 'Records are archived, never deleted', 'Sensitive fields are encrypted at rest'] },
  { key: 'Dental charting', d: 'Tooth-by-tooth charting in standard notation with DMF and dmf index tracking.', b: ['FDI notation for permanent and primary teeth', 'The DMF index updates as teeth are marked', 'Chart history is kept for every school year'], demo: 'chart' },
  { key: 'Appointments', d: 'Scheduling and monitoring with follow-up flags and parental supervision flags.', b: ['Follow-ups that are due are flagged', 'Parental supervision is marked per student', 'Works on phone, tablet and laptop'] },
  { key: 'RPC monitoring', d: 'The two-visit Routine Prevention Care program, tracked step by step.', b: ['Visit 1 and Visit 2 each have their own checklist', 'Progress per student is visible at a glance', 'Feeds the caries risk assessment'], demo: 'rpc' },
  { key: 'Risk analytics', d: 'Classifies caries risk as High, Medium or Low and suggests treatment.', b: ['DMF and dmf index is the main input', 'The dentist validates every recommendation before clinical action', 'Assists the dentist and never replaces clinical judgment'], demo: 'risk' },
  { key: 'Reports', d: 'Dashboards and DOH-aligned reports built from the records.', b: ['School Oral Health Status and Service Report', 'Consolidated report for the City Health Office', 'Age bracket and gender counts, monthly'] },
] as const;

export const SCHOOLS = [
  { name: 'Bagong Tanyag Integrated School', grades: 'K–G10', text: 'Primary school of the program. Kindergarten through Grade 10.' },
  { name: 'Bagong Tanyag Elementary School Annex A', grades: 'K–G6', text: 'Elementary annex, Kindergarten through Grade 6.' },
  { name: 'South Daang Hari Elementary School Main', grades: 'K–G6', text: 'Elementary main campus, Kindergarten through Grade 6.' },
] as const;

export const ROLES = [
  ['System Admin', 'Creates and deactivates accounts, assigns roles and schools, reads the full audit trail, restores archived records.'],
  ['Dentist', 'Owns patient records, charting, appointments and risk analytics. Validates every treatment recommendation.'],
  ['Dental Aide', 'Patient records, appointments, clinic coordination and RPC monitoring.'],
  ['School Administrator', 'Views school reports and dashboards. No clinical records.'],
  ['Barangay Health Office Staff', 'Consolidated reports across all schools and City Health Office submission.'],
] as const;

export const FLOW = [
  { t: 'Scan or register', p: 'The aide scans the paper IPTR or types the record. Floral reads name, birthday, sex, address, contact, PhilHealth and 4Ps numbers, then shows them for review.', kv: [['Who', 'Dental Aide'], ['Saved only after', 'Staff confirm the fields']] },
  { t: 'Chart the teeth', p: 'The dentist marks each tooth in standard notation. The DMF index updates as teeth are marked.', kv: [['Who', 'Dentist'], ['Records', 'Tooth status, treatment done']] },
  { t: 'Two RPC visits', p: 'Each visit has a five-step checklist. Follow-ups and parental supervision flags are raised for the clinic.', kv: [['Who', 'Dentist and Dental Aide'], ['Records', 'Visit steps, appointments']] },
  { t: 'Validate the risk', p: 'Floral suggests High, Medium or Low. The dentist validates or changes it before any clinical action.', kv: [['Who', 'Dentist'], ['Records', 'Final risk level and who set it']] },
  { t: 'Report', p: 'School and consolidated reports are built from the records, by age bracket and gender, every month.', kv: [['Who', 'School Administrator, Barangay Health Office Staff'], ['Output', 'DOH-aligned reports']] },
] as const;

export const ACCESS_COLS = ['System Admin', 'Dentist', 'Dental Aide', 'School Administrator', 'BHO Staff'] as const;
export const ACCESS_ROWS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['Manage accounts and schools', [1, 0, 0, 0, 0]],
  ['Student records', [0, 1, 1, 0, 0]],
  ['Dental charting', [0, 1, 0, 0, 0]],
  ['Appointments and RPC', [0, 1, 1, 0, 0]],
  ['Risk analytics (validate)', [0, 1, 0, 0, 0]],
  ['School reports and dashboards', [0, 1, 1, 1, 1]],
  ['Consolidated reports', [0, 0, 0, 0, 1]],
  ['Audit trail and archive', [1, 0, 0, 0, 0]],
];

export const RPC_STEPS = ['Oral screening', 'Prophylaxis', 'Fluoride varnish', 'Hygiene instruction', 'Caries risk assessment'] as const;

export const FAQ = [
  ["Who can see a student's record?", 'Dentists and dental aides can open clinical records. School administrators see reports only.'],
  ['Can a record be deleted?', 'No. Records are archived and only the System Admin can view or restore them.'],
  ['Does the risk suggestion decide treatment?', 'No. It is a suggestion for the dentist, who validates or changes it before any clinical action.'],
  ['What happens without internet?', 'Charting and treatment are saved on the device and sent in order when the connection returns. Screens that need the server are disabled meanwhile.'],
  ['Which devices work?', 'Phone, tablet and laptop, through the browser. There is no separate mobile app.'],
] as const;

export const UPPER_TEETH = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
export const LOWER_TEETH = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
