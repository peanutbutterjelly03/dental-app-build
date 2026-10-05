// What a queued write sends so the SERVER can recognise a retry and catch a clash
// (server/utils/syncConflict.ts, crudFactory). Pure, so it is tested on its own.

interface Sendable {
  id?: number;
  method: string;
  body: unknown;
  operationId?: string;
  baselineSnapshot?: Record<string, unknown>;
}

const newOperationId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The id minted when a change is queued. Same change, same id, however many times
 *  it is sent: that is what makes a retry safe. */
export const mintOperationId = newOperationId;

/** The request body with its `_sync` envelope: the change's id, and (for an edit)
 *  the values the device last saw for the fields it is changing, so the server can
 *  tell whether someone else changed them since. A body-less call (an archive)
 *  and a non-object body are sent untouched. */
export function bodyWithSync(write: Sendable): unknown {
  const body = write.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const base: Record<string, unknown> = {};
  if (write.method !== 'POST' && write.baselineSnapshot) {
    for (const key of Object.keys(body)) {
      if (key in write.baselineSnapshot) base[key] = write.baselineSnapshot[key];
    }
  }
  return { ...(body as Record<string, unknown>), _sync: { operationId: write.operationId ?? newOperationId(), base } };
}

// Resource path segment -> the server's model name, for the sync-conflicts routes.
const MODEL_OF: Record<string, string> = {
  students: 'Student',
  'student-iptrs': 'StudentIptr',
  'medical-histories': 'MedicalHistory',
  'dietary-social-habits': 'DietarySocialHabits',
  'oral-health-conditions': 'OralHealthCondition',
  'dental-charts': 'DentalChart',
  'tooth-records': 'ToothRecord',
  treatments: 'Treatment',
  'preventive-care-records': 'PreventiveCareRecord',
  referrals: 'Referral',
};

/** `/students/64b5...` -> { model: 'Student', recordId: '64b5...' }; null for anything
 *  that is not a single offline-module record. */
export function conflictTarget(endpoint: string): { model: string; recordId: string } | null {
  const match = /^\/([a-z-]+)\/([0-9a-f]{24})$/i.exec(endpoint.split('?')[0]);
  if (!match || !MODEL_OF[match[1]]) return null;
  return { model: MODEL_OF[match[1]], recordId: match[2] };
}
