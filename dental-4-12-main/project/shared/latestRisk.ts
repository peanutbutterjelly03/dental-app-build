// Which dentist-validated assessment IS a student's current risk level
// (dashboard audit item 5, 2026-10-04).
//
// The student list and the sidebar badge used to take the FIRST school year
// (IPTR, in insertion order) that had any validated result: usually the
// OLDEST, so a student reviewed High last year and Low this year still counted
// as High. The current level is the assessment on the most recent VISIT; when
// two share a visit date, the one the dentist validated last.

export interface RiskCandidateRow {
  risk_level: string;
  /** The RPC visit the assessment belongs to (PREVENTIVE_CARE_RECORD.visit_date). */
  visit_date?: Date | string | null;
  validated_at?: Date | string | null;
}

const time = (v: Date | string | null | undefined) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

/** The latest of a student's validated assessments, or null when there is none. */
export function latestRisk<T extends RiskCandidateRow>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (!best) { best = r; continue; }
    const byVisit = time(r.visit_date) - time(best.visit_date);
    if (byVisit > 0 || (byVisit === 0 && time(r.validated_at) >= time(best.validated_at))) best = r;
  }
  return best;
}
