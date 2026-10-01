// 2026-10-01, Risk Classification redesign: which tab a pupil lands in
// (reviewed / needs review / not checked yet), the stored suggestion, and the
// caries columns. Judged on the LATEST RPC visit.

import { describe, it, expect } from 'vitest';
import { buildRiskCandidates, filterRiskCandidates, reviewSummary, type RiskCandidatesInput, type RiskStrat } from './riskCandidates';

function input(over: Partial<RiskCandidatesInput> = {}): RiskCandidatesInput {
  return {
    students: [{ _id: 'st1', school_id: 's1', sex: 'Male', birthday: '2013-05-30', grade_level: 'Grade 8', section: 'Mabini', last_name: 'Aquino', first_name: 'Rafael' }],
    schools: [{ _id: 's1', school_name: 'BTIS' }],
    iptrs: [{ _id: 'i1', student_id: 'st1', school_year: '2026-2027' }],
    charts: [],
    toothRecords: [],
    orals: [],
    dietaries: [],
    preventives: [
      { _id: 'p1', iptr_id: 'i1', visit_date: '2026-08-12T00:00:00.000Z' },
      { _id: 'p2', iptr_id: 'i1', visit_date: '2027-01-15T00:00:00.000Z' },
    ],
    risks: [],
    ...over,
  };
}
const risk = (id: string, preventive: string, validated: boolean, extra: Partial<RiskStrat> = {}): RiskStrat => ({
  _id: id, preventive_id: preventive, risk_level: 'High', dmf_score: 5, validated_by_dentist: validated, ...extra,
});
const row = (over: Partial<RiskCandidatesInput> = {}) => buildRiskCandidates(input(over))[0];

describe('review status, on the LATEST visit', () => {
  it('no RPC visit at all: no_visit (a result must attach to a visit)', () => {
    expect(row({ preventives: [] }).status).toBe('no_visit');
  });

  it('latest visit with nothing yet: not_checked', () => {
    expect(row().status).toBe('not_checked');
  });

  it('a stored, unvalidated suggestion: needs_review, carrying the model level and confidence', () => {
    const r = row({ risks: [risk('r1', 'p2', false, { model_risk_level: 'Medium', model_confidence: 0.72 })] });
    expect(r.status).toBe('needs_review');
    expect(r.suggestion).toEqual({ id: 'r1', level: 'Medium', confidence: 0.72 });
  });

  it('a validated result on the latest visit: reviewed, and no suggestion shown', () => {
    const r = row({ risks: [risk('r1', 'p2', true)] });
    expect(r.status).toBe('reviewed');
    expect(r.suggestion).toBeNull();
  });

  it('a review of an OLDER visit does not count: the latest visit is still not_checked', () => {
    expect(row({ risks: [risk('r1', 'p1', true)] }).status).toBe('not_checked');
  });

  it('history is VALIDATED results only; an unreviewed suggestion is not an assessment', () => {
    const r = row({ risks: [risk('old', 'p1', true), risk('sugg', 'p2', false)] });
    expect(r.history.map((h) => h.id)).toEqual(['old']);
  });
});

describe('caries columns and teeth come from the latest charting WITH records', () => {
  it('an empty re-charting does not blank the figures (BUG-12 rule)', () => {
    const r = row({
      charts: [
        { _id: 'c1', iptr_id: 'i1', date_charted: '2026-08-12' },
        { _id: 'c2', iptr_id: 'i1', date_charted: '2026-09-01' }, // newer, but empty
      ],
      toothRecords: [
        { chart_id: 'c1', condition: 'D', tooth_number: 46 },
        { chart_id: 'c1', condition: '✓', tooth_number: 11 },
      ],
    });
    expect(r.teeth).toEqual([{ tooth: 46, condition: 'D' }, { tooth: 11, condition: '✓' }]);
    expect(r.caries).toMatchObject({ withCariesExperience: true, withActiveCaries: true, cariesFreeTeeth: 1 });
  });

  it('nothing charted: caries-free teeth is null ("—" on screen), not 0', () => {
    expect(row().caries.cariesFreeTeeth).toBeNull();
  });
});

// R3: the Students list's Risk chip uses reviewSummary directly, so it must
// agree with the Risk Classification row built from the same data.
describe('reviewSummary (Students list chip)', () => {
  it('shows the suggestion level while it waits, the dentist level once reviewed', () => {
    expect(reviewSummary(true, [{ risk_level: 'High', model_risk_level: 'Medium', validated_by_dentist: false }]))
      .toMatchObject({ status: 'needs_review', level: 'Medium', reviewedAt: null });
    expect(reviewSummary(true, [
      { risk_level: 'High', validated_by_dentist: false },
      { risk_level: 'Low', validated_by_dentist: true, validated_at: '2026-10-01T02:00:00.000Z' },
    ])).toMatchObject({ status: 'reviewed', level: 'Low', reviewedAt: '2026-10-01T02:00:00.000Z' });
  });

  it('no visit and no rows are different states', () => {
    expect(reviewSummary(false, []).status).toBe('no_visit');
    expect(reviewSummary(true, []).status).toBe('not_checked');
  });

  it('studentId narrows the list to one pupil', () => {
    const base = input();
    const all = buildRiskCandidates({ ...base, students: [...base.students, { ...base.students[0], _id: 'st2', last_name: 'Bautista' }] });
    expect(filterRiskCandidates(all, {}).total).toBe(2);
    expect(filterRiskCandidates(all, { studentId: 'st2' }).rows.map((r) => r.id)).toEqual(['st2']);
  });
});
