// ─── Risk review: treatment suggestions, findings, skip reasons ─────────────
//
// 2026-10-01, Risk Classification redesign (classmate's design; rules chosen by
// the user from her screenshots, "go with your recommendations"). Pure, shared
// by the review popup and the server, and tested.
//
// ⚠ These are SUGGESTIONS the dentist accepts or skips one by one; nothing here
// changes the chart or books a treatment. The rules are clinical: ask the
// dentist to confirm them before the defense (HANDOFF).
//
// Nothing here may import mongoose or React.

export type RiskLevel = 'High' | 'Medium' | 'Low';

export interface ChartedTooth {
  tooth: number;
  condition: string;
}

export type SuggestedCode = 'FV' | 'PF' | 'SDF';

export interface SuggestedTreatment {
  code: SuggestedCode;
  /** FDI tooth number, or null for a whole-mouth treatment. */
  tooth: number | null;
  /** Plain-language reason shown to the dentist. */
  why: string;
}

/** Why a suggested treatment was skipped. A fixed list: a chosen reason holds
 *  no patient detail, so it needs no encryption and can be counted. The server
 *  model validates against this same list. */
export const SKIP_REASONS = [
  'Already treated',
  'Not needed on examination',
  'Guardian declined',
  'Referred elsewhere',
  'Planned for a later visit',
] as const;
export type SkipReason = typeof SKIP_REASONS[number];

/**
 * The rules, as her design shows them:
 *  - FV (Fluoride Varnish), whole mouth, when the CONFIRMED level is Medium or High;
 *  - PF (Permanent Filling) for each permanent tooth charted D (decayed);
 *  - SDF (Silver Diamine Fluoride) for each primary tooth charted d (decayed).
 * Order: FV first, then PF, then SDF, each by tooth number, as her popup lists
 * them. Uses the CONFIRMED level, so changing the level in step 2 changes the
 * list in step 3.
 */
export function suggestTreatments(teeth: ChartedTooth[], confirmedLevel: RiskLevel | null): SuggestedTreatment[] {
  const out: SuggestedTreatment[] = [];
  if (confirmedLevel === 'High' || confirmedLevel === 'Medium') {
    out.push({ code: 'FV', tooth: null, why: 'Medium or High risk' });
  }
  const byTooth = [...teeth].sort((a, b) => a.tooth - b.tooth);
  for (const t of byTooth) {
    if (t.condition === 'D') out.push({ code: 'PF', tooth: t.tooth, why: `Tooth ${t.tooth} is marked D (decayed)` });
  }
  for (const t of byTooth) {
    if (t.condition === 'd') out.push({ code: 'SDF', tooth: t.tooth, why: `Tooth ${t.tooth} is marked d (decayed baby tooth)` });
  }
  return out;
}

export interface FindingInputs {
  teeth: ChartedTooth[];
  sugarBeverages: boolean;
  gingivitis: boolean;
  calculus: boolean;
}

/**
 * "Findings": REAL facts from this pupil's chart and forms. Deliberately not
 * called "Reasons" (user decision 2026-10-01): the model does not explain an
 * individual prediction, so presenting these as its reasoning would invent it.
 */
export function riskFindings({ teeth, sugarBeverages, gingivitis, calculus }: FindingInputs): string[] {
  const list = (code: string) => teeth.filter((t) => t.condition === code).map((t) => t.tooth);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const out: string[] = [];
  const D = list('D');
  if (D.length) out.push(`${plural(D.length, 'decayed permanent tooth', 'decayed permanent teeth')} (${D.join(', ')})`);
  const d = list('d');
  if (d.length) out.push(`${plural(d.length, 'decayed baby tooth', 'decayed baby teeth')} (${d.join(', ')})`);
  const filled = list('F').length + list('f').length;
  if (filled) out.push(`${plural(filled, 'filled tooth', 'filled teeth')} from earlier visits`);
  const missing = list('M').length + list('m').length;
  if (missing) out.push(`${plural(missing, 'missing tooth', 'missing teeth')}`);
  if (sugarBeverages) out.push('Takes sugar-sweetened drinks or food (dietary form)');
  if (gingivitis) out.push('Gingivitis noted');
  if (calculus) out.push('Calculus noted');
  return out;
}

/** Plain-language label for the model's confidence (her design's "Very sure"). */
export function confidenceLabel(confidence: number | null | undefined): string | null {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return null;
  if (confidence >= 0.8) return 'Very sure';
  if (confidence >= 0.6) return 'Fairly sure';
  return 'Not sure';
}
