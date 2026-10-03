import { useCallback, useEffect, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import { surnameFirst } from '../utils/studentName';
import type {
  ApiStudent,
  ApiSchool,
  ApiStudentIptr,
  ApiDentalChart,
  ApiToothRecord,
  ApiOralHealthCondition,
  ApiDietarySocialHabits,
  ApiPreventiveCareRecord,
  ApiRiskStratification,
} from '../api/types';

// Mirrors ml-service predictor.FEATURE_COLUMNS — assembled from the
// student's real records, client-side joins per this codebase's convention
// (same pattern as useStudents/useDentalChartData).
export interface StudentMlFeatures {
  dmf_score: number;
  decayed_count: number;
  missing_count: number;
  filled_count: number;
  gingivitis: 0 | 1;
  periodontal_disease: 0 | 1;
  debris: 0 | 1;
  calculus: 0 | 1;
  abnormal_growth: 0 | 1;
  sugar_beverages: 0 | 1;
  tobacco_user: 0 | 1;
  age: number;
  sex: 0 | 1;
}

export interface RiskHistoryEntry {
  id: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  recommendation: string;
  dmfScore: number;
  validated: boolean;
  validatedAt: string | null;
  visitDate: string;
}

export interface RiskCandidate {
  id: string;
  name: string;
  school: string;
  grade: string;
  section: string;
  features: StudentMlFeatures;
  dmfIndex: 'DMF' | 'dmf';
  // risk assessments attach to an RPC visit per the ERD (preventive_id FK);
  // null means the student has no RPC visit yet, so nothing to attach to
  latestPreventiveId: string | null;
  history: RiskHistoryEntry[];
}

function calcAge(birthday: string): number {
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000)));
}

export function useRiskClassification() {
  const [candidates, setCandidates] = useState<RiskCandidate[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    beginLoad();
    try {
      const [students, schools, iptrs, charts, toothRecords, ohcs, dshs, preventives, riskStrats] =
        await Promise.all([
          apiClient.get<ApiStudent[]>('/students'),
          apiClient.get<ApiSchool[]>('/schools'),
          apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
          apiClient.get<ApiDentalChart[]>('/dental-charts'),
          apiClient.get<ApiToothRecord[]>('/tooth-records'),
          apiClient.get<ApiOralHealthCondition[]>('/oral-health-conditions'),
          apiClient.get<ApiDietarySocialHabits[]>('/dietary-social-habits'),
          apiClient.get<ApiPreventiveCareRecord[]>('/preventive-care-records'),
          apiClient.get<ApiRiskStratification[]>('/risk-stratifications'),
        ]);

      const schoolNameById = new Map(schools.map((s) => [s._id, s.school_name]));
      const iptrsByStudent = new Map<string, ApiStudentIptr[]>();
      for (const iptr of iptrs) {
        const list = iptrsByStudent.get(iptr.student_id) ?? [];
        list.push(iptr);
        iptrsByStudent.set(iptr.student_id, list);
      }
      const chartsByIptr = new Map<string, ApiDentalChart[]>();
      for (const c of charts) {
        const list = chartsByIptr.get(c.iptr_id) ?? [];
        list.push(c);
        chartsByIptr.set(c.iptr_id, list);
      }
      const teethByChart = new Map<string, ApiToothRecord[]>();
      for (const t of toothRecords) {
        const list = teethByChart.get(t.chart_id) ?? [];
        list.push(t);
        teethByChart.set(t.chart_id, list);
      }
      const ohcByIptr = new Map(ohcs.map((o) => [o.iptr_id, o]));
      const dshByIptr = new Map(dshs.map((d) => [d.iptr_id, d]));
      const preventivesByIptr = new Map<string, ApiPreventiveCareRecord[]>();
      for (const p of preventives) {
        const list = preventivesByIptr.get(p.iptr_id) ?? [];
        list.push(p);
        preventivesByIptr.set(p.iptr_id, list);
      }
      const riskByPreventive = new Map<string, ApiRiskStratification[]>();
      for (const r of riskStrats) {
        const list = riskByPreventive.get(r.preventive_id) ?? [];
        list.push(r);
        riskByPreventive.set(r.preventive_id, list);
      }

      const rows: RiskCandidate[] = students.map((s) => {
        const studentIptrs = (iptrsByStudent.get(s._id) ?? [])
          .slice()
          .sort((a, b) => a.school_year.localeCompare(b.school_year));
        const allTeeth = studentIptrs
          .flatMap((iptr) => chartsByIptr.get(iptr._id) ?? [])
          .flatMap((c) => teethByChart.get(c._id) ?? []);

        // same condition-code convention as DentalChart.tsx: D/M/F permanent,
        // d/m/f temporary teeth
        let decayed = 0, missing = 0, filled = 0, temporary = 0;
        for (const t of allTeeth) {
          const c = t.condition;
          if (c === 'D' || c === 'd') decayed++;
          else if (c === 'M' || c === 'm') missing++;
          else if (c === 'F' || c === 'f') filled++;
          if (c === 'd' || c === 'm' || c === 'f') temporary++;
        }

        // most recent school year's records win for conditions/habits
        const ohc = studentIptrs.map((i) => ohcByIptr.get(i._id)).filter(Boolean).pop();
        const dsh = studentIptrs.map((i) => dshByIptr.get(i._id)).filter(Boolean).pop();

        const studentPreventives = studentIptrs
          .flatMap((i) => preventivesByIptr.get(i._id) ?? [])
          .sort((a, b) => a.visit_date.localeCompare(b.visit_date));
        const history: RiskHistoryEntry[] = studentPreventives.flatMap((p) =>
          (riskByPreventive.get(p._id) ?? []).map((r) => ({
            id: r._id,
            riskLevel: r.risk_level,
            recommendation: r.recommendation ?? '',
            dmfScore: r.dmf_score,
            validated: r.validated_by_dentist ?? false,
            validatedAt: r.validated_at ?? null,
            visitDate: p.visit_date.slice(0, 10),
          }))
        );

        const b = (v: boolean | undefined): 0 | 1 => (v ? 1 : 0);
        return {
          id: s._id,
          name: surnameFirst(s),
          school: schoolNameById.get(s.school_id) ?? 'Unknown School',
          grade: s.grade_level,
          section: s.section,
          features: {
            dmf_score: decayed + missing + filled,
            decayed_count: decayed,
            missing_count: missing,
            filled_count: filled,
            gingivitis: b(ohc?.gingivitis),
            periodontal_disease: b(ohc?.periodontal_disease),
            debris: b(ohc?.debris),
            calculus: b(ohc?.calculus),
            abnormal_growth: b(ohc?.abnormal_growth),
            sugar_beverages: b(dsh?.sugar_beverages),
            tobacco_user: b(dsh?.tobacco_user),
            age: calcAge(s.birthday),
            sex: s.sex === 'M' || s.sex === 'Male' ? 1 : 0,
          },
          dmfIndex: temporary > 0 ? 'dmf' : 'DMF',
          latestPreventiveId: studentPreventives.length
            ? studentPreventives[studentPreventives.length - 1]._id
            : null,
          history,
        };
      });

      // Alphabetical by surname, matching every other list (2026-09-02).
      // `name` is surnameFirst, so this is surname order.
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setCandidates(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load student data');
    } finally {
      endLoad();
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { candidates, loading, error, reload };
}
