import { useCallback, useEffect, useState } from 'react';
import { useLoadPhase } from './useLoadPhase';
import { apiClient } from '../api/client';
import type {
  ApiStudent,
  ApiSchool,
  ApiStudentIptr,
  ApiMedicalHistory,
  ApiDietarySocialHabits,
  ApiOralHealthCondition,
  ApiDentalChart,
  ApiToothRecord,
  ApiTreatment,
  ApiDentist,
} from '../api/types';

export interface IptrYearData {
  iptr: ApiStudentIptr;
  medicalHistory: ApiMedicalHistory | null;
  dietaryHabits: ApiDietarySocialHabits | null;
  oralCondition: ApiOralHealthCondition | null;
  dentalChart: ApiDentalChart | null;
  toothRecords: ApiToothRecord[];
  treatments: ApiTreatment[];
}

export function useDentalChartData(studentId: string | undefined) {
  const [student, setStudent] = useState<ApiStudent | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [years, setYears] = useState<IptrYearData[]>([]);
  const [dentists, setDentists] = useState<ApiDentist[]>([]);
  const { loading, beginLoad, endLoad } = useLoadPhase();
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!studentId) {
      endLoad();
      return;
    }
    beginLoad();
    try {
      // Every list below is fetched FILTERED to this student (Sprint 48).
      // It used to pull whole collections and filter them here — every IPTR,
      // medical history, chart and tooth record in the database, to find the
      // ~3 rows belonging to one child. Measured at 14-58 MB per open at the
      // 8,000-student scale. The join keys are unencrypted ObjectIds, so the
      // server can match them (encrypted fields could not — see CLAUDE.md).
      const [studentDoc, schools, myIptrsRaw, dentistList] = await Promise.all([
        apiClient.get<ApiStudent>(`/students/${studentId}`),
        apiClient.get<ApiSchool[]>('/schools'),
        apiClient.get<ApiStudentIptr[]>(`/student-iptrs?student_id=${studentId}`),
        apiClient.get<ApiDentist[]>('/dentists'),
      ]);

      setStudent(studentDoc);
      setSchoolName(schools.find((s) => s._id === studentDoc.school_id)?.school_name ?? 'Unknown School');
      setDentists(dentistList);

      const myIptrs = [...myIptrsRaw].sort((a, b) => a.school_year.localeCompare(b.school_year));
      const iptrIds = new Set(myIptrs.map((i) => i._id));

      // A student with no IPTR years has nothing to join to — skip five
      // round-trips that could only return empty.
      const iptrQuery = myIptrs.map((i) => i._id).join(',');
      const [allMedical, allDiet, allOral, allCharts, allTreatments] = iptrQuery
        ? await Promise.all([
            apiClient.get<ApiMedicalHistory[]>(`/medical-histories?iptr_id=${iptrQuery}`),
            apiClient.get<ApiDietarySocialHabits[]>(`/dietary-social-habits?iptr_id=${iptrQuery}`),
            apiClient.get<ApiOralHealthCondition[]>(`/oral-health-conditions?iptr_id=${iptrQuery}`),
            apiClient.get<ApiDentalChart[]>(`/dental-charts?iptr_id=${iptrQuery}`),
            apiClient.get<ApiTreatment[]>(`/treatments?iptr_id=${iptrQuery}`),
          ])
        : [[], [], [], [], []];

      const myCharts = allCharts.filter((c) => iptrIds.has(c.iptr_id));
      const chartIds = myCharts.map((c) => c._id);
      const allToothRecords = chartIds.length
        ? await apiClient.get<ApiToothRecord[]>(`/tooth-records?chart_id=${chartIds.join(',')}`)
        : [];

      const yearData: IptrYearData[] = myIptrs.map((iptr) => {
        const dentalChart = myCharts.find((c) => c.iptr_id === iptr._id) ?? null;
        return {
          iptr,
          medicalHistory: allMedical.find((m) => m.iptr_id === iptr._id) ?? null,
          dietaryHabits: allDiet.find((d) => d.iptr_id === iptr._id) ?? null,
          oralCondition: allOral.find((o) => o.iptr_id === iptr._id) ?? null,
          dentalChart,
          toothRecords: dentalChart ? allToothRecords.filter((t) => t.chart_id === dentalChart._id) : [],
          treatments: allTreatments.filter((t) => t.iptr_id === iptr._id),
        };
      });

      setYears(yearData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dental chart data');
    } finally {
      endLoad();
    }
  }, [studentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { student, schoolName, years, dentists, loading, error, reload };
}
