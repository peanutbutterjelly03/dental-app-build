// A queued write, in the words staff would use. Pure — drives the "back online"
// dialog. Only describes what the write itself says; it never invents detail.
interface Describable {
  endpoint: string;
  method: string;
  body: unknown;
}

const MODULE_OF: Record<string, string> = {
  students: 'Students',
  'student-iptrs': 'Students',
  'dental-charts': 'Dental chart',
  'tooth-records': 'Dental chart',
  'medical-histories': 'Dental chart',
  'dietary-social-habits': 'Dental chart',
  'oral-health-conditions': 'Dental chart',
  'preventive-care-records': 'Dental chart',
  treatments: 'Treatments',
  referrals: 'Treatments',
};

const NOUN: Record<string, string> = {
  students: 'Student record',
  'student-iptrs': 'School year record',
  'dental-charts': 'Dental chart',
  'tooth-records': 'Tooth record',
  'medical-histories': 'Medical history',
  'dietary-social-habits': 'Dietary & social habits',
  'oral-health-conditions': 'Oral health conditions',
  'preventive-care-records': 'RPC visit',
  treatments: 'Treatment',
  referrals: 'Referral',
};

/** "appointment_datetime" -> "Appointment Datetime" */
export function humanizeField(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A value as a person would read it; empty ones say so instead of showing nothing. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function humanize(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function describeWrite(write: Describable): { module: string; kind: string; detail?: string } {
  const [path] = write.endpoint.split('?');
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0] ?? 'record';
  const archived = parts[parts.length - 1] === 'archive';
  const body = (typeof write.body === 'object' && write.body ? write.body : {}) as Record<string, unknown>;

  const module = MODULE_OF[resource] ?? humanize(resource);
  const noun = NOUN[resource] ?? humanize(resource).replace(/s$/, '');
  const verb = archived ? 'archived' : write.method === 'POST' ? 'added' : 'updated';
  const kind = `${noun} ${verb}`;

  let detail: string | undefined;
  if (resource === 'students') {
    const last = str(body.last_name);
    const first = str(body.first_name);
    if (last || first) detail = [last, first].filter(Boolean).join(', ');
  } else if (resource === 'student-iptrs') {
    detail = str(body.school_year);
  } else if (resource === 'tooth-records' && body.tooth_number !== undefined) {
    detail = `#${body.tooth_number}${str(body.condition) ? ` — ${str(body.condition)}` : ''}`;
  } else if (resource === 'treatments') {
    detail = str(body.treatment_done) ?? str(body.diagnosis);
  } else if (resource === 'preventive-care-records' && body.visit_number !== undefined) {
    detail = `Visit ${body.visit_number}`;
  }
  return { module, kind, detail };
}
