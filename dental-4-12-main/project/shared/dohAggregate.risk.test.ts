// 2026-10-01, Risk Classification redesign: model suggestions are now STORED as
// RISK_STRATIFICATION rows with validated_by_dentist: false, waiting for the
// dentist. None of that may reach a figure filed with the City Health Office.
// The route queries validated rows only; this pins the second safety net
// inside the aggregate itself.

import { describe, it, expect } from 'vitest';
import { aggregateDohReport, type DohAggregateInput, type AggRisk } from './dohAggregate';

function input(risks: AggRisk[]): DohAggregateInput {
  return {
    schools: [{ _id: 's1', school_name: 'Test School' }],
    students: [{ _id: 'st1', school_id: 's1', sex: 'Male', birthday: '2014-03-01' }],
    iptrs: [{ _id: 'i1', student_id: 'st1', school_year: '2026-2027', grade_level: 'Grade 6' }],
    medicals: [],
    dietaries: [],
    orals: [],
    preventives: [{ _id: 'p1', iptr_id: 'i1', visit_number: 1, visit_date: '2026-08-12' } as DohAggregateInput['preventives'][number]],
    risks,
    charts: [],
    toothRecords: [],
    referrals: [],
    schoolYear: '2026-2027',
    schoolName: null,
  };
}

const risk = (validated: boolean | undefined): AggRisk => ({
  preventive_id: 'p1', dmf_score: 3, dmf_index: 'DMF', risk_level: 'Low',
  ...(validated === undefined ? {} : { validated_by_dentist: validated }),
});

describe('DOH report: an UNREVIEWED suggestion changes no filed figure', () => {
  it('a stored suggestion (validated_by_dentist: false) counts exactly like no risk row at all', () => {
    const none = aggregateDohReport(input([])).counts;
    const unreviewed = aggregateDohReport(input([risk(false)])).counts;
    expect(unreviewed).toEqual(none);
  });

  it('the same row, once validated, DOES count (so the test above is not vacuous)', () => {
    const none = aggregateDohReport(input([])).counts;
    const validated = aggregateDohReport(input([risk(true)])).counts;
    expect(validated).not.toEqual(none);
  });

  it('a row without the flag is treated as validated (every caller already filters)', () => {
    expect(aggregateDohReport(input([risk(undefined)])).counts)
      .toEqual(aggregateDohReport(input([risk(true)])).counts);
  });
});
