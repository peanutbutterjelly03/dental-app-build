// Copy for the public pages. Facts only, taken from the project spec: no counts of
// students or visits, no statistics. Anything numeric that is not a fixed fact of
// the system (3 schools, 5 roles, 7 modules, 2 RPC visits) comes from the database
// after sign-in, never from here.

export const MODULES = [
  ['Account access', 'Five roles with strict permissions. Each person sees only what their job needs.', 'mod-access'],
  ['Appointment', 'Scheduling and monitoring with follow-up flags and parental supervision flags.', 'mod-appointment'],
  ['Student Records', 'The digital IPTR: registration, medical history, habits and oral health conditions.', 'mod-records'],
  ['Dental charting', 'Tooth-by-tooth charting in standard notation with DMF and dmf index tracking.', 'mod-charting'],
  ['Risk Classification', 'Suggests High, Medium or Low caries risk. The dentist validates it.', 'mod-risk'],
  ['Treatment', 'Treatment records and recommendations that follow written rules. The dentist confirms them.', 'mod-treatment'],
  ['RPC Monitoring', 'The two-visit Routine Prevention Care program, tracked step by step.', 'mod-rpc'],
  ['Reports', 'Dashboards and DOH-aligned reports built from the records.', 'mod-reports'],
] as const;

export const FEATURES = [
  { tag: 'Dental charting', title: 'Chart every tooth, in standard notation', text: 'Mark each tooth on the chart and the DMF index updates as you go. Every school year keeps its own chart.', bullets: ['FDI notation for permanent and primary teeth', 'Select teeth first, then pick a code', 'Works offline and syncs later'], image: 'work-charting' },
  { tag: 'RPC Monitoring', title: 'Two visits, tracked to completion', text: 'Each visit has the same five steps. Follow-ups that are due and parental supervision are flagged for the clinic.', bullets: ['Oral screening, prophylaxis, fluoride varnish', 'Hygiene instruction and caries risk assessment', 'Progress per student at a glance'], image: 'work-rpc' },
  { tag: 'Risk Classification', title: 'A second opinion, never the final word', text: 'Floral suggests High, Medium or Low caries risk from the chart and records. The dentist validates or changes it before any clinical action.', bullets: ['Main input is the DMF and dmf index', 'Every assessment is in the audit trail', 'Assists the dentist and never replaces judgment'], image: 'work-risk' },
  { tag: 'Reports', title: 'DOH forms, filled from the records', text: 'Reports keep every row and column of the official form. Cells fill from the database and stay blank where there is no data.', bullets: ['School and consolidated reports', 'By age bracket and gender, every month', 'Print, or download as PDF or Excel'], image: 'work-reports' },
] as const;

export const ROLE_CARDS = [
  { name: 'System Admin', text: 'Creates accounts, assigns roles and schools, reads the audit trail and restores archived records.', image: 'role-admin' },
  { name: 'Dentist', text: 'Owns the chart. Validates every risk level and treatment recommendation.', image: 'role-dentist' },
  { name: 'Dental Aide', text: 'Keeps records current, books appointments and runs the RPC visits.', image: 'role-aide' },
  { name: 'School Administrator', text: 'Reads the school reports and dashboard. No clinical records.', image: 'role-school' },
  { name: 'Barangay Health Office Staff', text: 'Reads consolidated reports across all schools and submits to the City Health Office.', image: 'role-bho' },
] as const;

export const SCHOOLS = [
  { name: 'Bagong Tanyag Integrated School', lines: ['Bagong Tanyag', 'Integrated School'], grades: 'Kinder to Grade 10', text: 'An integrated school serving learners from Kindergarten through Grade 10 on one campus. Its clinic sees the widest range of ages in the program, from young children to teenagers, and Floral keeps each student\u2019s dental record in one place as they move up the grades.' },
  { name: 'Bagong Tanyag Elementary School Annex A', lines: ['Bagong Tanyag Elementary', 'School Annex A'], grades: 'Kinder to Grade 6', text: 'An annex of the elementary school, serving Kindergarten through Grade 6. Students are screened and cared for at their own campus, and their dental records follow them from one school year to the next.' },
  { name: 'South Daang Hari Elementary School Main', lines: ['South Daang Hari', 'Elementary School Main'], grades: 'Kinder to Grade 6', text: 'The main campus of the elementary school, serving Kindergarten through Grade 6. Visits are scheduled around the school day, and the clinic can see each child\u2019s earlier visits before starting the next one.' },
] as const;

export const CLINIC_SERVICES = [
  ['Oral Screening', 'The dentist looks at each tooth and the gums, and records the findings on the child\u2019s chart.'],
  ['Oral Prophylaxis', 'The teeth are cleaned to remove plaque and calculus, so the mouth starts the visit fresh.'],
  ['Fluoride Varnish Application', 'A varnish is painted on the teeth to strengthen the enamel and help prevent decay.'],
  ['Oral Hygiene Instruction or Counseling', 'The child learns how to brush and care for their teeth, in words they can follow.'],
  ['Caries Risk Assessment', 'The visit ends with a High, Medium or Low risk level. The dentist validates it before any treatment is planned.'],
] as const;

export const FAQ = [
  ["Who can see a student's record?", 'Dentists and dental aides can open clinical records. School administrators see reports only.'],
  ['Can a record be deleted?', 'No. Records are archived and only the System Admin can view or restore them.'],
  ['Does the risk suggestion decide treatment?', 'No. It is a suggestion for the dentist, who validates or changes it before any clinical action.'],
  ['What happens without internet?', 'Charting and treatment are saved on the device and sent in order when the connection returns. Screens that need the server are disabled meanwhile.'],
  ['Which devices work?', 'Phone, tablet and laptop, through the browser. There is no separate mobile app.'],
] as const;
