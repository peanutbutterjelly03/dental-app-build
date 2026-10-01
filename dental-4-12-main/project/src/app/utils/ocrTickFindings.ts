import type { IptrCheckboxFinding } from './iptrOcrShared';

// O2b (2026-10-01): the IPTR Year 1-5 tick findings, from the Verify screen
// into that school year's MEDICAL_HISTORY / DIETARY_SOCIAL_HABITS /
// ORAL_HEALTH_CONDITION. Decisions (user, 2026-10-01): every finding starts
// UNCHECKED (findings are reviewed, never auto-applied), and a Year select
// picks which column is THIS school year.

/** How a ticked row can be saved:
 *  - 'storable': a yes/no field on the model, saved as `true` when accepted.
 *  - 'text':     Allergies / Others / Last Admission. The model stores TEXT
 *                there, so a tick is never written as `true`; the encoder
 *                types the details on the chart.
 *  - 'unstorable': Orally Fit, Dental Caries, Completely Edentulous. The
 *                form prints them; the data model has no field for them. */
export type TickKind = 'storable' | 'text' | 'unstorable';

export function tickKind(f: IptrCheckboxFinding): TickKind {
  if (f.field === null) return 'unstorable';
  return f.text ? 'text' : 'storable';
}

/** Stable key for the accept checkboxes ("Others" exists in two sections). */
export const tickKey = (f: IptrCheckboxFinding) => `${f.section}:${f.label}`;

/** The column to show first: the LATEST Year with any tick (earlier columns
 *  are earlier school years on the same sheet); Year 1 when none has any. */
export function defaultTickYear(findings: IptrCheckboxFinding[]): number {
  const years = findings.flatMap((f) => f.years);
  return years.length ? Math.max(...years) : 1;
}

export interface TickBodies {
  medical?: Record<string, boolean>;
  dietary?: Record<string, boolean>;
  oral?: Record<string, boolean>;
}

/** The record bodies for the accepted, storable ticks in `year`. A section
 *  with nothing accepted gets NO body: creating an all-false record would
 *  claim "Hindi" to every question in it, which nobody answered. */
export function tickBodies(findings: IptrCheckboxFinding[], year: number, accepted: Set<string>): TickBodies {
  const out: TickBodies = {};
  for (const f of findings) {
    if (tickKind(f) !== 'storable' || !f.years.includes(year) || !accepted.has(tickKey(f))) continue;
    (out[f.section] ??= {})[f.field as string] = true;
  }
  return out;
}
