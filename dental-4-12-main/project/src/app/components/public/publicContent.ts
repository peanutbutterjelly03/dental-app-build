// Copy for the public pages. Facts only, taken from the project spec: no counts of
// students or visits, no statistics. Anything numeric that is not a fixed fact of
// the system (3 schools, 5 roles, 7 modules, 2 RPC visits) comes from the database
// after sign-in, never from here.

export const MODULES = [
  ['Account access', 'Five roles with strict permissions. Each person sees only what their job needs.'],
  ['Appointment', 'Scheduling and monitoring with follow-up flags and parental supervision flags.'],
  ['Student Records', 'The digital IPTR: registration, medical history, habits and oral health conditions.'],
  ['Dental charting', 'Tooth-by-tooth charting in standard notation with DMF and dmf index tracking.'],
  ['Risk Classification', 'Suggests High, Medium or Low caries risk. The dentist validates it.'],
  ['Treatment', 'Treatment records and recommendations that follow written rules. The dentist confirms them.'],
  ['RPC Monitoring', 'The two-visit Routine Prevention Care program, tracked step by step.'],
  ['Reports', 'Dashboards and DOH-aligned reports built from the records.'],
  ['School', 'The three partner schools, their staff assignments and the school year.'],
] as const;

export type FeatureKind = 'chart' | 'rpc' | 'risk' | 'reports';

export const FEATURES: ReadonlyArray<{ kind: FeatureKind; tag: string; title: string; text: string; bullets: readonly string[]; url: string; chip: readonly [string, string] }> = [
  { kind: 'chart', tag: 'Dental charting', title: 'Chart every tooth, in standard notation', text: 'Mark each tooth on the chart and the DMF index updates as you go. Every school year keeps its own chart.', bullets: ['FDI notation for permanent and primary teeth', 'Select teeth first, then pick a code', 'Works offline and syncs later'], url: 'floral / dental-charts', chip: ['Standard notation', 'FDI, permanent and primary'] },
  { kind: 'rpc', tag: 'RPC Monitoring', title: 'Two visits, tracked to completion', text: 'Each visit has the same five steps. Follow-ups that are due and parental supervision are flagged for the clinic.', bullets: ['Oral screening, prophylaxis, fluoride varnish', 'Hygiene instruction and caries risk assessment', 'Progress per student at a glance'], url: 'floral / rpc', chip: ['Two visits', 'Each with its own checklist'] },
  { kind: 'risk', tag: 'Risk Classification', title: 'A second opinion, never the final word', text: 'Floral suggests High, Medium or Low caries risk from the chart and records. The dentist validates or changes it before any clinical action.', bullets: ['Main input is the DMF and dmf index', 'Every assessment is in the audit trail', 'Assists the dentist and never replaces judgment'], url: 'floral / risk-classification', chip: ['Dentist validates', 'Before any clinical action'] },
  { kind: 'reports', tag: 'Reports', title: 'DOH forms, filled from the records', text: 'Reports keep every row and column of the official form. Cells fill from the database and stay blank where there is no data.', bullets: ['School and consolidated reports', 'By age bracket and gender, every month', 'Print, or download as PDF or Excel'], url: 'floral / reports', chip: ['Download as PDF or Excel', 'From the same screen'] },
];

export const ROLE_CARDS = [
  { name: 'System Admin', icon: 'admin', text: 'Creates accounts, assigns roles and schools, reads the audit trail and restores archived records.', opens: ['Account access', 'School', 'Audit trail and archive'] },
  { name: 'Dentist', icon: 'dentist', text: 'Owns the chart. Validates every risk level and treatment recommendation.', opens: ['Student Records', 'Dental charting', 'Risk Classification', 'Treatment', 'RPC Monitoring', 'Appointment', 'Reports'] },
  { name: 'Dental Aide', icon: 'aide', text: 'Keeps records current, books appointments and runs the RPC visits.', opens: ['Student Records', 'Appointment', 'RPC Monitoring'] },
  { name: 'School Administrator', icon: 'school', text: 'Reads the school reports and dashboard. No clinical records.', opens: ['Reports for their school'] },
  { name: 'Barangay Health Office Staff', icon: 'bho', text: 'Reads consolidated reports across all schools and submits to the City Health Office.', opens: ['Consolidated reports'] },
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
