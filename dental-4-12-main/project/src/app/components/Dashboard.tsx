import { useAuth } from '../context/AuthContext';
import {
  Users,
  AlertCircle,
  Calendar,
  Shield,
    FileText,
  TrendingUp,
  Activity,
  Eye,
  CheckCircle,
  Clock,
  BarChart3,
  ArrowRight,
  ChevronRight
} from 'lucide-react';
import { SkeletonBlock } from './Skeleton';
import { getGradeColor } from '../utils/gradeColors';
import { CHART, RISK_COLORS, FUNNEL_RAMP } from '../utils/chartColors';
import { getSchoolShortName } from '../utils/schoolColors';
import { toLocalDateString, formatDateWithWeekday } from '../utils/localDate';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { Link } from 'react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStudents } from '../hooks/useStudents';
import { useAppointments } from '../hooks/useAppointments';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { apiClient } from '../api/client';
import type { ApiUser, ApiTreatment, ApiStudentIptr, ApiAuditTrail, ApiRiskStratification } from '../api/types';
import { windowStart, AUDIT_WINDOW_DAYS } from '../hooks/useAuditTrail';
import { treatmentCodes, treatmentLabel } from './DentalChart';

export const Dashboard = () => {
  const { user, selectedSchool } = useAuth();

  // Chart colors live in one shared module (Sprint 32 / audit U3) so every
  // screen's charts speak the same semantic color language.

  const { students: allStudentsRaw, loading: studentsLoading } = useStudents();
  // The dashboard reads exactly two things from appointments — today's list and
  // the current calendar week's bar chart — so it loads that week and nothing
  // else (Sprint 56). Computed once per mount: rebuilding the instants on every
  // render would change the hook's dependencies and refetch in a loop.
  const weekWindow = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59, 59, 999);
    return { from, to };
  }, []);
  const { sessions: allSessions, loading: appointmentsLoading } = useAppointments(weekWindow);
  const { records: rpcRecords, loading: rpcLoading } = useRPCTracking();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [treatmentCount, setTreatmentCount] = useState(0);
  const [iptrsByStudent, setIptrsByStudent] = useState<Map<string, string[]>>(new Map());
  const [chartedIptrIds, setChartedIptrIds] = useState<Set<string>>(new Set());
  const [auditEntries, setAuditEntries] = useState<ApiAuditTrail[]>([]);
  const [toothRecords, setToothRecords] = useState<{ chart_id: string; treatment_code?: string }[]>([]);
  const [riskStrats, setRiskStrats] = useState<ApiRiskStratification[]>([]);
  const [chartIptrById, setChartIptrById] = useState<Map<string, string>>(new Map());
  const [iptrStudentById, setIptrStudentById] = useState<Map<string, string>>(new Map());
  const [preventiveIptrById, setPreventiveIptrById] = useState<Map<string, string>>(new Map());
  const [extraLoading, setExtraLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // /users and /audit-trails are both system_admin-only on the backend
        // (Sprint 15 RBAC) — the other 4 roles got a 403 here, which threw
        // uncaught inside Promise.all and left extraLoading (and the whole
        // dashboard) stuck on "Loading dashboard…" forever, since
        // setExtraLoading(false) never ran. Only fetch them for the role
        // that actually needs them (System Admin dashboard only) and has
        // permission.
        const [apiUsers, treatments, iptrs, charts, audits, teeth, risks, preventives] = await Promise.all([
          user?.role === 'system_admin' ? apiClient.get<ApiUser[]>('/users') : Promise.resolve([]),
          apiClient.get<ApiTreatment[]>('/treatments'),
          apiClient.get<ApiStudentIptr[]>('/student-iptrs'),
          apiClient.get<{ _id: string; iptr_id: string }[]>('/dental-charts'),
          // Sprint 92: bounded to the same window the Audit Trail screen uses.
          // Every consumer below wants recent activity (today's events, the
          // busiest module today, the 5 most recent) EXCEPT actions-by-module,
          // which counted all time — that chart's subtitle now says the window
          // rather than letting a bounded count read as the whole history.
          user?.role === 'system_admin'
            ? apiClient.get<ApiAuditTrail[]>(`/audit-trails?from=${encodeURIComponent(windowStart().toISOString())}`)
            : Promise.resolve([]),
          apiClient.get<{ chart_id: string; treatment_code?: string }[]>('/tooth-records'),
          apiClient.get<ApiRiskStratification[]>('/risk-stratifications'),
          apiClient.get<{ _id: string; iptr_id: string }[]>('/preventive-care-records'),
        ]);
        setUsers(apiUsers);
        setTreatmentCount(treatments.length);
        const byStudent = new Map<string, string[]>();
        for (const i of iptrs) {
          const list = byStudent.get(i.student_id) ?? [];
          list.push(i._id);
          byStudent.set(i.student_id, list);
        }
        setIptrsByStudent(byStudent);
        setChartedIptrIds(new Set(charts.map((c) => c.iptr_id)));
        setAuditEntries(audits);
        setToothRecords(teeth);
        setRiskStrats(risks);
        setChartIptrById(new Map(charts.map((c) => [c._id, c.iptr_id])));
        setIptrStudentById(new Map(iptrs.map((i) => [i._id, i.student_id])));
        setPreventiveIptrById(new Map(preventives.map((p) => [p._id, p.iptr_id])));
      } catch (err) {
        // Defense in depth: even if something else in this block fails,
        // never leave the dashboard stuck on the loading screen forever.
        console.error('Dashboard extra data fetch failed:', err);
      } finally {
        setExtraLoading(false);
      }
    })();
  }, []);

  const allStudents = useMemo(
    () => (selectedSchool ? allStudentsRaw.filter((s) => s.school === selectedSchool) : allStudentsRaw),
    [allStudentsRaw, selectedSchool],
  );
  const todaySessions = useMemo(() => {
    const today = toLocalDateString(new Date());
    const sessions = selectedSchool ? allSessions.filter((s) => s.school === selectedSchool) : allSessions;
    return sessions.filter((s) => s.date === today);
  }, [allSessions, selectedSchool]);
  const scopedRpc = useMemo(
    () => (selectedSchool ? rpcRecords.filter((r) => r.school === selectedSchool) : rpcRecords),
    [rpcRecords, selectedSchool],
  );
  const highRiskCount = allStudents.filter((s) => s.riskLevel === 'High').length;
  const mediumRiskCount = allStudents.filter((s) => s.riskLevel === 'Medium').length;
  const lowRiskCount = allStudents.filter((s) => s.riskLevel === 'Low').length;
  const screenedCount = allStudents.filter((s) => s.riskLevel !== null).length;
  const rpcCompletionRate = scopedRpc.length ? Math.round((scopedRpc.filter((r) => r.status === 'complete').length / scopedRpc.length) * 100) : 0;
  const pendingChartsCount = allStudents.filter((s) => {
    const iptrIds = iptrsByStudent.get(s.id) ?? [];
    return iptrIds.length > 0 && !iptrIds.some((id) => chartedIptrIds.has(id));
  }).length;
  const rpcOverdueCount = scopedRpc.filter((r) => r.status === 'overdue').length;
  const rpcPendingCount = scopedRpc.filter((r) => r.status === 'pending').length;
  // Clinic summary strip (Sprint A): the numerator behind rpcCompletionRate, and
  // the Visit-1 rate the funnel card used to compute inline. Both are over
  // scopedRpc (RPC records), NOT allStudents -- a student with no RPC record is
  // absent from this denominator, so these must never be captioned as a share
  // of enrolled patients.
  const rpcBothVisitsCount = scopedRpc.filter((r) => r.status === 'complete').length;
  const rpcVisit1Count = scopedRpc.filter((r) => r.visit1Status === 'Completed').length;
  const rpcVisit1Rate = scopedRpc.length ? Math.round((rpcVisit1Count / scopedRpc.length) * 100) : 0;

  // School lookup for records that reach a student via chart→iptr or preventive→iptr chains
  const studentSchoolById = useMemo(
    () => new Map(allStudentsRaw.map((s) => [s.id, s.school])),
    [allStudentsRaw],
  );

  // Procedures actually recorded on dental charts (ToothRecord.treatment_code), school-scoped
  const procedureBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of toothRecords) {
      if (!t.treatment_code) continue;
      const studentId = iptrStudentById.get(chartIptrById.get(t.chart_id) ?? '');
      if (selectedSchool && (!studentId || studentSchoolById.get(studentId) !== selectedSchool)) continue;
      counts.set(t.treatment_code, 1 + (counts.get(t.treatment_code) ?? 0));
    }
    return [...counts.entries()]
      .map(([code, count]) => {
        const t = treatmentCodes.find((c) => c.code === code);
        // Local term included — this chart is read by clinic staff, not filed.
        return { code, label: t ? treatmentLabel(t) : code, count };
      })
      .sort((a, b) => b.count - a.count);
  }, [toothRecords, chartIptrById, iptrStudentById, studentSchoolById, selectedSchool]);

  // Dentist-validated risk assessments grouped by month (validated_at is the only
  // real date on RISK_STRATIFICATION — unvalidated ones have no date, so they're
  // honestly excluded rather than given a fabricated one)
  const assessmentsByMonth = useMemo(() => {
    const byMonth = new Map<string, { High: number; Medium: number; Low: number }>();
    for (const r of riskStrats) {
      if (!r.validated_at) continue;
      const studentId = iptrStudentById.get(preventiveIptrById.get(r.preventive_id) ?? '');
      if (selectedSchool && (!studentId || studentSchoolById.get(studentId) !== selectedSchool)) continue;
      const month = r.validated_at.slice(0, 7); // YYYY-MM
      const bucket = byMonth.get(month) ?? { High: 0, Medium: 0, Low: 0 };
      bucket[r.risk_level]++;
      byMonth.set(month, bucket);
    }
    // No validations at all → empty array so the honest NoDataYet state shows
    if (byMonth.size === 0) return [];
    // Fixed rolling window: last 6 months up to the current month, zeros
    // included — a lone data month reads as a timeline ("started in July"),
    // not a single floating bar. Zero months are real zeros, not fabricated.
    const months: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
      });
    }
    // if any validations predate the window, chart them too (don't hide data)
    const older = [...byMonth.keys()].filter((k) => k < months[0].key).sort();
    const keys = [
      ...older.map((k) => ({ key: k, label: new Date(k + '-02').toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }) })),
      ...months,
    ];
    return keys.map(({ key, label }) => ({
      month: label,
      ...(byMonth.get(key) ?? { High: 0, Medium: 0, Low: 0 }),
    }));
  }, [riskStrats, preventiveIptrById, iptrStudentById, studentSchoolById, selectedSchool]);

  // RPC follow-ups needing attention: overdue first, then due within 60 days
  const upcomingFollowUps = useMemo(() => {
    const due = scopedRpc.filter(
      (r) => r.status === 'overdue' || (r.status === 'pending' && r.daysUntilDue <= 60),
    );
    // daysUntilDue is negative when overdue, so ascending = most overdue first
    return due.sort((a, b) => a.daysUntilDue - b.daysUntilDue).slice(0, 6);
  }, [scopedRpc]);

  // Most-overdue student, for the clinic summary footer. upcomingFollowUps is
  // sorted ascending and daysUntilDue is negative when overdue, so [0] is the
  // worst case -- but it also carries not-yet-due records, hence the < 0 guard.
  // null means nothing is overdue, and the footer drops that clause entirely
  // rather than printing "0 days overdue".
  const mostOverdueDays =
    upcomingFollowUps[0] && upcomingFollowUps[0].daysUntilDue < 0
      ? Math.abs(upcomingFollowUps[0].daysUntilDue)
      : null;

  // Real appointment sessions for the current calendar week, bucketed by day + status.
  const weekAppointmentsByDay = useMemo(() => {
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const scoped = selectedSchool ? allSessions.filter((s) => s.school === selectedSchool) : allSessions;
    return DAY_LABELS.map((label, i) => {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      const dateStr = toLocalDateString(day);
      const daySessions = scoped.filter((s) => s.date === dateStr);
      return {
        day: label,
        completed: daySessions.filter((s) => s.status === 'Completed').length,
        scheduled: daySessions.filter((s) => s.status === 'Scheduled' || s.status === 'In Progress').length,
        cancelled: daySessions.filter((s) => s.status === 'Missed').length,
      };
    });
  }, [allSessions, selectedSchool]);

  // Tiles are shaped by meaning, not four identical boxes (Sprint 23h / audit
  // U2): tinted icon chip, big tabular number, and status tiles (destructive/
  // success) carry their color on the number + footnote too. Chip/tint style
  // derives from the existing `color` prop so no call site changes.
  const STAT_CHIP: Record<string, { chip: string; val: string; foot: string }> = {
    'text-destructive': { chip: 'bg-danger-surface text-destructive', val: 'text-destructive', foot: 'text-destructive font-semibold' },
    'text-success': { chip: 'bg-success-surface text-success', val: 'text-success', foot: 'text-muted-foreground' },
    'text-cyan-600': { chip: 'bg-cyan-50 text-cyan-700', val: 'text-foreground', foot: 'text-muted-foreground' },
    // Watch Amber (--warning). Call sites used to pass `text-yellow-600`, which
    // had no entry here and silently fell through to the blue default — the code
    // said yellow, the screen said blue. Repointed to the token rather than
    // adding a raw yellow-600 key, per DESIGN.md's status vocabulary. The value
    // stays foreground-colored (like text-cyan-600, unlike the destructive /
    // success alarm tiles) because one of these tiles renders a date, not a count.
    'text-warning': { chip: 'bg-warning-surface text-warning', val: 'text-foreground', foot: 'text-muted-foreground' },
  };
  // `loading` (Sprint 23w / audit X3): the tile shell + icon + label render
  // immediately; only the value pulses until this tile's own data source
  // lands — stat tiles no longer wait on the slowest dashboard fetch.
  const StatCard = ({ icon: Icon, label, value, color, trend, progress, linkTo, loading }: any) => {
    const style = STAT_CHIP[color] ?? { chip: 'bg-primary-surface text-primary', val: 'text-foreground', foot: 'text-muted-foreground' };
    const content = (
      <>
        <div className="flex items-center justify-between mb-3">
          <span className={`w-9 h-9 rounded-lg grid place-items-center ${style.chip}`}>
            <Icon className="w-[18px] h-[18px]" />
          </span>
          {linkTo && (
            <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          )}
        </div>
        {loading ? (
          <SkeletonBlock className="h-[30px] w-16" />
        ) : (
          // A few tiles legitimately carry prose instead of a figure ("None
          // scheduled"). Rendering a sentence at stat-value size makes it shout
          // louder than the real numbers beside it, so prose steps down to the
          // Title role (18px/600). Detected rather than passed as a prop so no
          // call site can forget it. Anything starting with a digit stays a
          // figure — that deliberately keeps "17%", "2 of 3", and the ISO date
          // at full size, since those ARE the reading.
          <p className={
            /^\d/.test(String(value).trim())
              ? `text-3xl font-extrabold leading-none tracking-tight tabular-nums ${style.val}`
              : `text-lg font-semibold leading-snug ${style.val}`
          }>{value}</p>
        )}
        <p className="text-xs text-muted-foreground font-medium mt-1.5">{label}</p>
        {!loading && trend && (
          <p className={`text-[11px] mt-2.5 flex items-center gap-1 ${style.foot}`}>
            {trend}
          </p>
        )}
        {!loading && progress !== undefined && (
          <div className="mt-2.5 w-full bg-muted rounded-full h-1.5" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`h-1.5 rounded-full grow-x ${color.replace('text-', 'bg-')}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </>
    );

    if (linkTo) {
      return (
        <Link to={linkTo} className="group bg-card rounded-xl border border-border p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer block">
          {content}
        </Link>
      );
    }

    return (
      <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
        {content}
      </div>
    );
  };

  // ===== CLINIC SUMMARY STRIP (Sprint A, design direction 3a) =====
  // Replaces the four equal-weight StatCards, which DESIGN.md calls out by name
  // as "the absence of hierarchy". Presented as clinical paperwork: ruled cells,
  // uppercase field labels, tabular figures, no icon chips, no tint, no shadow.
  // The strip is NOT clickable as a whole -- each cell is its own link.
  const SummaryCell = ({ icon: Icon, label, value, valueClass, context, linkTo, loading, trailing }: {
    icon: any; label: string; value: string; valueClass?: string; context: string;
    linkTo?: string; loading?: boolean; trailing?: string;
  }) => {
    const body = (
      <>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="flex items-center gap-[7px] min-w-0">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" strokeWidth={2} />
            <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground truncate">{label}</span>
          </span>
          {/* Chevron only where the cell actually navigates -- an affordance on a
              dead cell is a lie about what a click will do. */}
          {linkTo && <ChevronRight className="w-3 h-3 text-primary shrink-0" strokeWidth={2.5} />}
        </div>
        {loading ? (
          <SkeletonBlock className="h-7 w-16" />
        ) : (
          <div className="flex items-baseline gap-2">
            {/* Some cells legitimately carry prose or a date rather than a
                figure ("None scheduled"). Rendering a sentence at 28px makes it
                shout louder than the real numbers beside it, so it steps down
                to 15px/600 muted -- the treatment the 3a school-admin mock
                specifies. Detected the same way StatCard does it (`:269`) so no
                call site can forget the prop. Anything starting with a digit
                stays a figure, which keeps "17%", "2 of 3" and ISO dates at
                full size, since those ARE the reading. */}
            <span className={
              /^\d/.test(String(value).trim())
                ? `text-[28px] font-bold leading-none tabular-nums ${valueClass ?? 'text-foreground'}`
                : 'text-[15px] font-semibold leading-tight py-[5px] text-muted-foreground'
            }>{value}</span>
            {trailing && <span className="text-[11px] text-muted-foreground">{trailing}</span>}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground mt-1.5">{loading ? ' ' : context}</div>
      </>
    );

    // Cell tint replaces the old card lift; focus ring is explicit because these
    // are links and the previous tiles relied on the browser default.
    const cell = 'px-4 py-3.5 border-border';
    if (!linkTo) return <div className={cell}>{body}</div>;
    return (
      <Link
        to={linkTo}
        className={`${cell} block transition-colors duration-150 hover:bg-primary-surface focus-visible:bg-primary-surface focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2`}
      >
        {body}
      </Link>
    );
  };

  // ===== HORIZONTAL BAR ROW (Sprint C) =====
  // One row for all three bar charts (risk distribution, RPC funnel, school
  // oral-health status), which were three copies of the same markup.
  //
  // The value used to be absolutely positioned INSIDE the track, flipping
  // between "on the fill" and "after the fill" at a 22% threshold. Both
  // branches clip, because the track is overflow:hidden and the offsets are
  // percentages: a short fill pushes the label past the right edge, a long one
  // leaves no room after it. Narrow viewports make it worse. The value is now a
  // fixed-width sibling OUTSIDE the track, so no fill/width combination can
  // clip it, and the label truncates instead of squeezing the bar.
  // `valueText` overrides the default "N (P%)" for charts where each row has
  // its own denominator -- "1 (50%)" is ambiguous when the total differs per
  // row, so those pass "1 of 2" instead. Widens the value column to match.
  const BarRow = ({ label, value, pct, color, valueText }: { label: string; value: number; pct: number; color: string; valueText?: string }) => (
    // max-w caps the row in FULL-WIDTH cards, where a 100% bar became a very
    // long slab of solid color -- a lot of ink for "2 of 2". Self-limiting: the
    // half-width chart cards are already narrower than the cap, so they are
    // unaffected and no call site needs to opt in.
    <div className="flex items-center gap-3 max-w-3xl">
      <span className="text-xs text-muted-foreground basis-36 shrink min-w-0 truncate">{label}</span>
      <div className="flex-1 min-w-[110px] bg-muted rounded-md h-7 overflow-hidden">
        <div className="h-full rounded-md grow-x" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className={`${valueText ? 'w-[92px]' : 'w-[68px]'} shrink-0 text-right text-xs font-bold tabular-nums text-foreground`}>
        {valueText ?? `${value} (${pct}%)`}
      </span>
    </div>
  );

  // Shown in place of a chart/list when there's genuinely no real data
  // source to compute it from yet (e.g. no historical snapshots, no backing
  // model) -- never fabricate numbers just to make a chart look populated.
  const NoDataYet = ({ message }: { message: string }) => (
    <div className="flex items-center justify-center text-center px-4" style={{ height: 220 }}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );

  // Per-region loading (Sprint 23w / audit X3): each chart card swaps its own
  // body from skeleton to content as its data source arrives, instead of one
  // global gate on the slowest of 8 parallel fetches. The `.rise` on arrival
  // is the X4 state motion for "this region's data just landed".
  const ChartBody = ({ ready, children }: { ready: boolean; children: ReactNode }) =>
    ready ? (
      <div className="rise">{children}</div>
    ) : (
      <div aria-busy="true">
        <SkeletonBlock className="h-[220px] w-full" />
      </div>
    );

  // NOTE: a `SchoolBanner` component used to be defined here and was never
  // rendered anywhere -- dead code. It was the only mobile-reachable way to
  // switch schools, which is why switching was impossible on a phone. Sprint 33
  // put the switcher in the mobile drawer (Root.tsx), so it is removed rather
  // than wired up; the drawer covers every screen, not just the dashboard.

  // ===== DENTIST DASHBOARD =====
  if (user?.role === 'dentist') {
    // High first — the tier that needs attention reads first (audit U3:
    // horizontal bars over pie slices; easier magnitude comparison for
    // older/non-technical staff, colors stay the semantic risk palette)
    const riskDistributionData = [
      { name: 'High', value: highRiskCount, color: RISK_COLORS.high },
      { name: 'Medium', value: mediumRiskCount, color: RISK_COLORS.medium },
      { name: 'Low', value: lowRiskCount, color: RISK_COLORS.low },
    ];
    const riskTotal = highRiskCount + mediumRiskCount + lowRiskCount;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 rise">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dentist Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Welcome back, {user?.name}!</p>
          </div>
          {/* No "New Appointment" button here on purpose — removed on request.
              Booking lives on the Appointments page; the dashboard reports. The
              date and appointment count moved into the clinic summary strip
              (Sprints A/D) for the same reason. */}
        </div>

        {/* Clinic summary (Sprint A, direction 3a) — replaces the four KPI tiles */}
        <div className="bg-card border border-border rounded-sm overflow-hidden rise rise-1">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-muted border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-foreground">Clinic summary</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatDateWithWeekday(new Date())}
            </span>
          </div>

          {/* 1 column stacked with horizontal rules, 4 columns with vertical
              rules from lg. No 2-column middle step: at that width the context
              lines wrap and the ledger stops reading as a single row. */}
          <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <SummaryCell
              icon={Users}
              label="Patients enrolled"
              value={String(allStudents.length)}
              // "screened", not "validated" -- nothing filters on validated_at,
              // so claiming validation here would be false (see HANDOFF item 13).
              context={`${screenedCount} screened`}
              linkTo="/patients"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={Calendar}
              label="Appointments today"
              value={String(todaySessions.length)}
              context={todaySessions[0] ? `Next at ${todaySessions[0].time}` : 'None scheduled'}
              linkTo="/appointments"
              loading={appointmentsLoading}
            />
            <SummaryCell
              icon={AlertCircle}
              label="High-risk patients"
              value={String(highRiskCount)}
              // Same conditional as the old tile: foreground at 0, red above it.
              valueClass={highRiskCount > 0 ? 'text-destructive' : undefined}
              context={`${mediumRiskCount} medium · ${lowRiskCount} low`}
              linkTo="/patients?risk=high"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={Shield}
              label="RPC completion"
              value={`${rpcCompletionRate}%`}
              // Blue = operational state, per the v4 color rule: amber already
              // means "medium caries risk" on this same screen.
              valueClass="text-primary"
              trailing={`${rpcBothVisitsCount} of ${scopedRpc.length}`}
              context="Both visits completed"
              linkTo="/rpc"
              loading={rpcLoading}
            />
          </div>

          {!rpcLoading && scopedRpc.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border text-[11px] text-muted-foreground">
              {/* mostOverdueDays belongs to ONE student, so it can only be
                  attached to the figure when there is exactly one. With several
                  overdue it becomes "most by N days" rather than implying they
                  are all that far behind. */}
              {mostOverdueDays !== null && (
                <span className="text-primary font-semibold">
                  {rpcOverdueCount === 1
                    ? `1 student ${mostOverdueDays} day${mostOverdueDays !== 1 ? 's' : ''} overdue for Visit 2`
                    : `${rpcOverdueCount} students overdue for Visit 2, most by ${mostOverdueDays} days`}
                </span>
              )}
              {mostOverdueDays !== null && ' · '}
              Visit 1 done for {rpcVisit1Count} of {scopedRpc.length} ({rpcVisit1Rate}%) · target 100% by end of school year
            </div>
          )}
        </div>

        {/* Charts Row: Risk Distribution (LEFT) + Oral Health Trend (RIGHT, illustrative — see note above) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-2">
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground">Risk Distribution</h2>
            {/* "Recorded", not "Validated": this card reads
                RiskStratification.risk_level straight through
                (useStudents.ts:80) with no filter on validated_at, so the old
                wording claimed a dentist sign-off the data does not carry. The
                "Validated Risk Assessments" card lower down DOES filter on
                validated_at and keeps its wording. */}
            <p className="text-[11px] text-muted-foreground mb-3">Recorded caries-risk classification</p>
            <ChartBody ready={!studentsLoading}>
            {riskTotal === 0 ? (
              <NoDataYet message="No students with a recorded risk level yet." />
            ) : (
              <div className="space-y-2.5">
                {/* same horizontal-bar idiom as the RPC funnel/procedures cards */}
                {riskDistributionData.map((item) => (
                  <BarRow
                    key={item.name}
                    label={`${item.name} risk`}
                    value={item.value}
                    pct={Math.round((item.value / riskTotal) * 100)}
                    color={item.color}
                  />
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {riskTotal} student{riskTotal !== 1 ? 's' : ''} with a recorded risk level
                  {screenedCount !== riskTotal ? ` · ${screenedCount} screened in total` : ''}
                </p>
              </div>
            )}
            </ChartBody>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground">Oral Health Trend</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Mean DMFT index · last 6 months</p>
            {/* No historical monthly snapshots exist yet to compute a real
                trend from -- an honest empty state, not fabricated numbers. */}
            <NoDataYet message="No historical trend data yet. This chart will populate once monthly snapshots begin accumulating." />
          </div>
        </div>

        {/* Charts Row 2: RPC funnel + procedures — both computed from real records */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-3">
          <div className="bg-card p-4 rounded-xl border border-border">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">RPC Two-Visit Funnel</h2>
                <p className="text-[11px] text-muted-foreground">Preventive care progression</p>
              </div>
              <Link to="/rpc" className="text-xs text-primary hover:underline">RPC Tracking →</Link>
            </div>
            <ChartBody ready={!rpcLoading}>
            {scopedRpc.length === 0 ? (
              <NoDataYet message="No enrolled students yet." />
            ) : (
              <div className="space-y-2.5">
                {/* One measure at deepening stages: single-hue depth ramp,
                    darkest = widest. Count sits inside the bar when it fits,
                    beside it in ink when the bar is too short. */}
                {[
                  { label: 'Enrolled', value: scopedRpc.length, ...FUNNEL_RAMP[0] },
                  { label: 'Visit 1 completed', value: scopedRpc.filter((r) => r.visit1Status === 'Completed').length, ...FUNNEL_RAMP[1] },
                  { label: 'Both visits completed', value: scopedRpc.filter((r) => r.visit2Status === 'Completed').length, ...FUNNEL_RAMP[2] },
                ].map((step) => (
                  <BarRow
                    key={step.label}
                    label={step.label}
                    value={step.value}
                    pct={Math.round((step.value / scopedRpc.length) * 100)}
                    color={step.color}
                  />
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {rpcOverdueCount > 0 ? `${rpcOverdueCount} student${rpcOverdueCount !== 1 ? 's' : ''} overdue for Visit 2` : 'No students overdue for Visit 2'}
                </p>
              </div>
            )}
            </ChartBody>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground">Procedures Performed</h2>
            <p className="text-[11px] text-muted-foreground mb-3">From dental chart treatment records</p>
            <ChartBody ready={!extraLoading}>
            {procedureBreakdown.length === 0 ? (
              <NoDataYet message="No procedures recorded on dental charts yet." />
            ) : (
              <div className="space-y-2.5">
                {procedureBreakdown.slice(0, 6).map((p) => (
                  <div key={p.code} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-36 truncate shrink-0" title={p.label}>{p.label}</span>
                    <div className="flex-1 bg-muted rounded-md h-5">
                      <div className="h-full rounded-md bg-primary grow-x" style={{ width: `${(p.count / procedureBreakdown[0].count) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-foreground w-8 text-right shrink-0">{p.count}</span>
                  </div>
                ))}
              </div>
            )}
            </ChartBody>
          </div>
        </div>

        {/* Charts Row 3: validated assessments over time + follow-ups due */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-4">
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground">Validated Risk Assessments</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Dentist-validated each month</p>
            <ChartBody ready={!extraLoading}>
            {assessmentsByMonth.length === 0 ? (
              <NoDataYet message="No dentist-validated assessments yet — validated assessments will chart here by month." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={assessmentsByMonth}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* Risk levels use the app's established status colors; the surface-colored
                      stroke gives the 2px segment gap (the card showing through, not a white
                      line), legend + tooltip carry identity beyond color */}
                  {/* maxBarSize keeps a lone month from stretching into a slab */}
                  <Bar dataKey="High" stackId="risk" fill={RISK_COLORS.high} stroke={CHART.surface} strokeWidth={2} maxBarSize={48} />
                  <Bar dataKey="Medium" stackId="risk" fill={RISK_COLORS.medium} stroke={CHART.surface} strokeWidth={2} maxBarSize={48} />
                  <Bar dataKey="Low" stackId="risk" fill={RISK_COLORS.low} stroke={CHART.surface} strokeWidth={2} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
            </ChartBody>
          </div>

          <div className="bg-card p-4 rounded-xl border border-border">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">RPC Follow-ups Due</h2>
                <p className="text-[11px] text-muted-foreground">Overdue and due within 60 days</p>
              </div>
              <Link to="/rpc" className="text-xs text-primary hover:underline">View all →</Link>
            </div>
            <ChartBody ready={!rpcLoading}>
            {upcomingFollowUps.length === 0 ? (
              <NoDataYet message="No follow-ups overdue or due within 60 days." />
            ) : (
              <div className="divide-y divide-gray-100">
                {upcomingFollowUps.map((r) => {
                  // urgency reads as form, not just number: overdue red, due
                  // within a week amber, further out calm gray
                  const pill = r.status === 'overdue'
                    ? 'bg-danger-surface text-destructive'
                    : r.daysUntilDue <= 7
                      ? 'bg-warning-surface text-warning'
                      : 'bg-muted text-muted-foreground';
                  const initials = r.studentName
                    .split(/[\s,]+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w: string) => w[0])
                    .join('')
                    .toUpperCase();
                  return (
                    <div key={r.id} className="flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-primary-surface transition-colors">
                      <span className="w-8 h-8 rounded-lg bg-primary-surface text-primary grid place-items-center text-[11px] font-bold shrink-0">
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.studentName}</p>
                        <p className="text-xs text-muted-foreground">{r.grade} · {r.section}</p>
                      </div>
                      <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 tabular-nums ${pill}`}>
                        {r.status === 'overdue' ? `${Math.abs(r.daysUntilDue)}d overdue` : r.daysUntilDue === 0 ? 'due today' : `due in ${r.daysUntilDue}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            </ChartBody>
          </div>
        </div>
      </div>
    );
  }

  // ===== DENTAL AIDE DASHBOARD =====
  if (user?.role === 'dental_aide') {
    const appointmentsByStatusData = weekAppointmentsByDay;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 rise">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dental Aide Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Welcome back, {user?.name}!</p>
          </div>
          {/* No "New Appointment" button here on purpose — removed on request.
              Booking lives on the Appointments page; the dashboard reports. The
              date and appointment count moved into the clinic summary strip
              (Sprints A/D) for the same reason. */}
        </div>

        {/* Clinic summary (Sprint D) — same strip as the dentist branch */}
        <div className="bg-card border border-border rounded-sm overflow-hidden rise rise-1">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-muted border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-foreground">Clinic summary</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatDateWithWeekday(new Date())}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <SummaryCell
              icon={Calendar}
              label="Appointments today"
              value={String(todaySessions.length)}
              context={todaySessions[0] ? `Next at ${todaySessions[0].time}` : 'None scheduled'}
              linkTo="/appointments"
              loading={appointmentsLoading}
            />
            <SummaryCell
              icon={FileText}
              label="Pending charts"
              value={String(pendingChartsCount)}
              context={`${allStudents.length - pendingChartsCount} of ${allStudents.length} charted`}
              linkTo="/dental-charts"
              loading={studentsLoading || extraLoading}
            />
            <SummaryCell
              icon={AlertCircle}
              label="RPC follow-ups overdue"
              value={String(rpcOverdueCount)}
              // Matches the old tile, which carried its color on the number.
              valueClass={rpcOverdueCount > 0 ? 'text-destructive' : undefined}
              context={mostOverdueDays !== null ? `Most overdue by ${mostOverdueDays} days` : 'None overdue'}
              linkTo="/rpc"
              loading={rpcLoading}
            />
            <SummaryCell
              icon={Shield}
              label="RPC visits pending"
              value={String(rpcPendingCount)}
              context={`${rpcBothVisitsCount} of ${scopedRpc.length} complete`}
              linkTo="/rpc"
              loading={rpcLoading}
            />
          </div>

          {!rpcLoading && scopedRpc.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border text-[11px] text-muted-foreground">
              {mostOverdueDays !== null && (
                <span className="text-primary font-semibold">
                  {rpcOverdueCount === 1
                    ? `1 student ${mostOverdueDays} day${mostOverdueDays !== 1 ? 's' : ''} overdue for Visit 2`
                    : `${rpcOverdueCount} students overdue for Visit 2, most by ${mostOverdueDays} days`}
                </span>
              )}
              {mostOverdueDays !== null && ' · '}
              Visit 1 done for {rpcVisit1Count} of {scopedRpc.length} ({rpcVisit1Rate}%) · target 100% by end of school year
            </div>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-2">
          {/* Appointments by Status - Stacked Bar Chart (real, current week) */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">Appointments by Status (This Week)</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Completed · scheduled · missed, per day</p>
            <ChartBody ready={!appointmentsLoading}>
            <ResponsiveContainer width="100%" height={220} key="appt-status-container">
              <BarChart data={appointmentsByStatusData} id="appointments-status-chart">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} key="appt-grid" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} key="appt-xaxis" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} key="appt-yaxis" />
                <Tooltip key="appt-tooltip" content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} key="appt-legend" />
                <Bar dataKey="completed" stackId="a" fill={CHART.success} name="Completed" key="appt-bar-completed" maxBarSize={48} />
                <Bar dataKey="scheduled" stackId="a" fill={CHART.brand} name="Scheduled" key="appt-bar-scheduled" maxBarSize={48} />
                <Bar dataKey="cancelled" stackId="a" fill={CHART.danger} name="Missed" key="appt-bar-cancelled" maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
            </ChartBody>
          </div>

          {/* Pending Tasks by Priority - no Task entity exists in the ERD,
              so there's no real data to chart -- honest empty state. */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-3">Pending Tasks by Priority</h2>
            <NoDataYet message="No task-tracking system exists yet -- there's no Task entity in the data model to report on." />
          </div>
        </div>

        {/* Task List -- same reason as above, no backing model */}
        <div className="bg-card p-4 rounded-xl border border-border rise rise-3">
          <h2 className="text-sm font-bold text-foreground mb-3">Pending Tasks</h2>
          <p className="text-sm text-muted-foreground text-center py-12">No task-tracking system exists yet.</p>
        </div>
      </div>
    );
  }

  // ===== SCHOOL ADMIN DASHBOARD =====
  if (user?.role === 'school_admin') {
    const schoolName = user.schools?.[0];
    const schoolStudents = schoolName ? allStudentsRaw.filter((s) => s.school === schoolName) : [];
    const schoolScreenedCount = schoolStudents.filter((s) => s.riskLevel !== null).length;
    const coveragePct = schoolStudents.length ? Math.round((schoolScreenedCount / schoolStudents.length) * 100) : 0;

    // Screening coverage per grade (Sprint H). Replaces the deleted donut with
    // a reading the summary strip cannot carry: the strip says 83% overall,
    // this says WHICH grades are behind, which is the actionable half for a
    // school administrator. Grades are sorted by the numeral in the label so
    // "Grade 10" files after "Grade 2" rather than between 1 and 2; anything
    // without a numeral (e.g. "Kinder") sorts first.
    const gradeOrder = (g: string) => {
      const n = g.match(/\d+/);
      return n ? Number(n[0]) : -1;
    };
    const coverageByGrade = [...new Set(schoolStudents.map((s) => s.grade))]
      .sort((a, b) => gradeOrder(a) - gradeOrder(b))
      .map((grade) => {
        const inGrade = schoolStudents.filter((s) => s.grade === grade);
        const screened = inGrade.filter((s) => s.riskLevel !== null).length;
        return { grade, screened, total: inGrade.length };
      });

    const oralHealthStatusData = [
      // semantic status colors (Sprint 23o): good=green, needs-care=red,
      // in-progress=brand blue, no-data-yet=neutral gray (not warning-amber)
      { name: 'Orally Fit', value: schoolStudents.filter((s) => s.oralStatus === 'Orally Fit').length, color: CHART.success },
      { name: 'Needs Treatment', value: schoolStudents.filter((s) => s.oralStatus === 'Needs Treatment').length, color: CHART.danger },
      { name: 'Under Treatment', value: schoolStudents.filter((s) => s.oralStatus === 'Under Treatment').length, color: CHART.brand },
      { name: 'Not Yet Screened', value: schoolStudents.filter((s) => s.oralStatus === 'Not Yet Screened').length, color: CHART.neutral },
    ];

    const schoolSessions = schoolName ? allSessions.filter((s) => s.school === schoolName) : [];
    const today = toLocalDateString(new Date());
    const upcomingEvents = schoolSessions
      .filter((s) => s.type === 'Bayanihan Mission' && s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({ name: s.type, date: s.date, school: s.school, students: s.studentCount }));
    const nextUpcomingSession = [...schoolSessions].filter((s) => s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 rise">
          <div>
            <h1 className="text-2xl font-bold text-foreground">School Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{user.schools?.[0]}</p>
          </div>
          {/* Date + enrolled count moved into the school summary (Sprint E). */}
          <Link
            to="/reports"
            className="ml-auto inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover transition-colors"
          >
            <FileText className="w-4 h-4" />
            View Reports
          </Link>
        </div>

        {/* School summary (Sprint E, design 3a) */}
        <div className="bg-card border border-border rounded-sm overflow-hidden rise rise-1">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-muted border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-foreground">School summary</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatDateWithWeekday(new Date())}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <SummaryCell
              icon={Users}
              label="Students enrolled"
              value={String(schoolStudents.length)}
              context={schoolName ? getSchoolShortName(schoolName) : 'No school assigned'}
              linkTo="/reports"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={CheckCircle}
              label="Students screened"
              value={String(schoolScreenedCount)}
              trailing={`${coveragePct}%`}
              context={
                schoolStudents.length - schoolScreenedCount > 0
                  ? `${schoolStudents.length - schoolScreenedCount} not yet screened`
                  : 'All students screened'
              }
              linkTo="/reports"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={Activity}
              label="Treatments completed"
              value={String(treatmentCount)}
              context={treatmentCount > 0 ? 'From dental chart records' : 'None recorded yet'}
              linkTo="/reports"
              loading={extraLoading}
            />
            {/* Value is a DATE or the words "None scheduled" -- SummaryCell's
                prose detection steps the sentence down so it does not outshout
                the three figures beside it. */}
            <SummaryCell
              icon={Calendar}
              label="Upcoming visits"
              value={nextUpcomingSession ? nextUpcomingSession.date : 'None scheduled'}
              context={upcomingEvents.length > 0 ? `${upcomingEvents.length} Bayanihan event${upcomingEvents.length !== 1 ? 's' : ''} booked` : 'No Bayanihan events booked'}
              linkTo="/appointments"
              loading={appointmentsLoading}
            />
          </div>
        </div>

        {/* Charts Row.
            The "Screening Coverage" donut was removed in Sprint G -- it rendered
            `coveragePct`, the same figure the summary strip's second cell now
            reports with better context, and it was the last radial/donut in the
            app. Sprint H put a per-grade breakdown in its place: a reading the
            strip cannot carry, since "83% overall" does not say WHICH grades are
            behind.

            Both cards are full width, stacked. The grade chart renders one row
            per grade that has students -- three on demo data, but up to twelve
            at a K-G10 school -- so side by side it would end up roughly three
            times the height of its neighbour. Full width also lets twelve grade
            labels and their "18 of 40" counts breathe. */}
        <div className="grid grid-cols-1 gap-4 rise rise-2">
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">Screening Coverage by Grade</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Students screened per grade level</p>
            <ChartBody ready={!studentsLoading}>
            {coverageByGrade.length === 0 ? (
              <NoDataYet message="No students enrolled at this school yet." />
            ) : (
              <div className="space-y-2.5">
                {coverageByGrade.map((g) => (
                  <BarRow
                    key={g.grade}
                    label={g.grade}
                    value={g.screened}
                    pct={Math.round((g.screened / g.total) * 100)}
                    color={CHART.brand}
                    valueText={`${g.screened} of ${g.total}`}
                  />
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {schoolScreenedCount} of {schoolStudents.length} screened overall ({coveragePct}%)
                </p>
              </div>
            )}
            </ChartBody>
          </div>

          {/* Oral Health Status - horizontal bars (Sprint 32) */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">Oral Health Status Breakdown</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Latest recorded status per student</p>
            <ChartBody ready={!studentsLoading}>
            {schoolStudents.length === 0 ? (
              <NoDataYet message="No students enrolled at this school yet." />
            ) : (
              <div className="space-y-2.5">
                {/* horizontal bars (audit U3) — same idiom as the dentist
                    dashboard's risk/funnel cards, semantic status colors */}
                {oralHealthStatusData.map((item) => (
                  <BarRow
                    key={item.name}
                    label={item.name}
                    value={item.value}
                    pct={Math.round((item.value / schoolStudents.length) * 100)}
                    color={item.color}
                  />
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {schoolStudents.length} student{schoolStudents.length !== 1 ? 's' : ''} enrolled
                </p>
              </div>
            )}
            </ChartBody>
          </div>
        </div>

        {/* Upcoming Bayanihan Events */}
        <div className="bg-card p-4 rounded-xl border border-border rise rise-3">
          <h2 className="text-sm font-bold text-foreground mb-0.5">Upcoming Bayanihan Events</h2>
          <p className="text-[11px] text-muted-foreground mb-3">Scheduled outreach missions at this school</p>
          <ChartBody ready={!appointmentsLoading}>
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No upcoming Bayanihan Mission events scheduled.</p>
          ) : (
            <div className="space-y-3">
              {upcomingEvents.map((event, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-primary-surface rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{event.name}</div>
                    <div className="text-sm text-muted-foreground">{event.date} • {event.school}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-primary">{event.students}</div>
                    <div className="text-xs text-muted-foreground">students expected</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </ChartBody>
        </div>
      </div>
    );
  }

  // ===== BARANGAY HEALTH OFFICE DASHBOARD =====
  if (user?.role === 'bho_staff') {
    const SCHOOLS_SHORT: Record<string, string> = {
      'Bagong Tanyag Integrated School': 'Bagong Tanyag Integrated',
      'Bagong Tanyag Elementary School Annex A': 'Annex A',
      'South Daang Hari Elementary School Main': 'South Daang Hari',
    };
    const schoolComparisonData = Object.entries(SCHOOLS_SHORT).map(([full, short]) => {
      const students = allStudentsRaw.filter((s) => s.school === full);
      return {
        school: short,
        screened: students.filter((s) => s.riskLevel !== null).length,
        treated: 0, // no real Treatment records exist yet — see HANDOFF
        highRisk: students.filter((s) => s.riskLevel === 'High').length,
      };
    });


    const bracketOf = (birthdate: string) => {
      const age = new Date().getFullYear() - new Date(birthdate).getFullYear();
      if (age <= 5) return '0-5 years';
      if (age <= 14) return '6-14 years';
      return '15-19 years';
    };
    const ageGroupData = ['0-5 years', '6-14 years', '15-19 years'].map((bracket) => {
      const inBracket = allStudentsRaw.filter((s) => bracketOf(s.birthdate) === bracket);
      return {
        bracket,
        total: inBracket.length,
        orallyFit: inBracket.filter((s) => s.oralStatus === 'Orally Fit').length,
        needsTreatment: inBracket.filter((s) => s.oralStatus === 'Needs Treatment').length,
      };
    });

    const totalStudents = allStudentsRaw.length;
    const totalScreened = allStudentsRaw.filter((s) => s.riskLevel !== null).length;
    const programCoveragePct = totalStudents ? Math.round((totalScreened / totalStudents) * 100) : 0;
    // Counts behind the percentages, so the summary strip can show "6 of 18"
    // beside "33%" instead of asking the reader to do the arithmetic.
    const orallyFitCount = allStudentsRaw.filter((s) => s.oralStatus === 'Orally Fit').length;
    const needsTreatmentCount = allStudentsRaw.filter((s) => s.oralStatus === 'Needs Treatment').length;
    const orallyFitPct = totalStudents ? Math.round((orallyFitCount / totalStudents) * 100) : 0;
    const schoolsParticipating = new Set(allStudentsRaw.map((s) => s.school)).size;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 rise">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Barangay Health Office Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Aggregated data across all schools</p>
          </div>
          {/* Date + totals moved into the barangay summary (Sprint F). */}
          <Link
            to="/reports"
            className="ml-auto inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover transition-colors"
          >
            <FileText className="w-4 h-4" />
            View Reports
          </Link>
        </div>

        {/* Barangay summary (Sprint F, design 3a) */}
        <div className="bg-card border border-border rounded-sm overflow-hidden rise rise-1">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-muted border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-foreground">Barangay summary</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatDateWithWeekday(new Date())}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <SummaryCell
              icon={Users}
              label="Students served"
              value={String(totalStudents)}
              context={`Across ${schoolsParticipating} school${schoolsParticipating !== 1 ? 's' : ''}`}
              linkTo="/reports"
              loading={studentsLoading}
            />
            {/* Coverage is BLUE and orally-fit is GREEN, per the mock and the
                Operational-vs-Clinical Rule: how much of the programme has been
                delivered is operational, what state the children's mouths are
                in is clinical. */}
            <SummaryCell
              icon={Activity}
              label="Program coverage"
              value={`${programCoveragePct}%`}
              valueClass="text-primary"
              trailing={`${totalScreened} of ${totalStudents}`}
              context={
                totalStudents - totalScreened > 0
                  ? `${totalStudents - totalScreened} student${totalStudents - totalScreened !== 1 ? 's' : ''} not yet screened`
                  : 'All students screened'
              }
              linkTo="/reports"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={CheckCircle}
              label="Orally fit"
              value={`${orallyFitPct}%`}
              valueClass="text-success"
              trailing={`${orallyFitCount} of ${totalStudents}`}
              context={
                needsTreatmentCount > 0
                  ? `${needsTreatmentCount} need${needsTreatmentCount === 1 ? 's' : ''} treatment`
                  : 'None needing treatment'
              }
              linkTo="/reports"
              loading={studentsLoading}
            />
            <SummaryCell
              icon={Shield}
              label="Schools participating"
              value={`${schoolsParticipating} of 3`}
              context={schoolsParticipating === 3 ? 'All barangay schools' : `${3 - schoolsParticipating} with no records yet`}
              linkTo="/reports"
              loading={studentsLoading}
            />
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-2">
          {/* School Comparison - Grouped Bar Chart */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">School Comparison</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Screened · treated · high-risk counts per school</p>
            <ChartBody ready={!studentsLoading}>
            <ResponsiveContainer width="100%" height={220} key="school-comparison-container">
              <BarChart data={schoolComparisonData} id="school-comparison-chart">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} key="school-grid" />
                <XAxis dataKey="school" angle={-15} textAnchor="end" height={80} tick={{ fontSize: 12 }} key="school-xaxis" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} key="school-yaxis" />
                <Tooltip key="school-tooltip" content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} key="school-legend" />
                <Bar dataKey="screened" fill={CHART.brand} name="Screened" key="school-bar-screened" maxBarSize={40} />
                <Bar dataKey="treated" fill={CHART.success} name="Treated" key="school-bar-treated" maxBarSize={40} />
                <Bar dataKey="highRisk" fill={CHART.danger} name="High Risk" key="school-bar-risk" maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
            </ChartBody>
          </div>

          {/* Monthly Coverage Trend - Area Chart */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-3">Monthly Program Coverage Trend</h2>
            {/* No historical monthly snapshots exist yet -- honest empty state. */}
            <NoDataYet message="No historical coverage data yet. This chart will populate once monthly snapshots begin accumulating." />
          </div>
        </div>

        {/* Age Group Breakdown Table */}
        <div className="bg-card p-4 rounded-xl border border-border rise rise-3">
          <h2 className="text-sm font-bold text-foreground mb-0.5">Age Group Breakdown</h2>
          <p className="text-[11px] text-muted-foreground mb-3">Oral health status by DOH age bracket, all schools</p>
          <ChartBody ready={!studentsLoading}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-border">
                {/* header vocabulary matches the shared table convention
                    (studentListTableStyles, 23q) — no tracked-uppercase one-off */}
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground">Age Bracket</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground">Total Students</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground">Orally Fit</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground">Needs Treatment</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-foreground">Fitness Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ageGroupData.map((group, idx) => (
                  <tr key={idx}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">{group.bracket}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{group.total}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-success font-medium">{group.orallyFit}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-destructive font-medium">{group.needsTreatment}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {group.total ? Math.round((group.orallyFit / group.total) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </ChartBody>
        </div>
      </div>
    );
  }

  // ===== SYSTEM ADMIN DASHBOARD =====
  if (user?.role === 'system_admin') {
    const activeUsersCount = users.filter((u) => !u.isArchived).length;

    // System summary figures (Sprint I). These replace three tiles that read
    // literal "N/A" -- uptime and failed logins are measured nowhere, and no
    // Task entity exists for "pending actions". Everything below comes from
    // /users and /audit-trails, both already fetched above.
    const archivedUsersCount = users.filter((u) => u.isArchived).length;
    const todayKey = toLocalDateString(new Date());
    // APPROXIMATE, and deliberately so: last_login holds one timestamp per
    // user, not a session log, so a user who signed in twice counts once and
    // one who signed in yesterday and is still active counts zero. Same
    // caveat the login-activity chart below already carries.
    const signedInTodayCount = users.filter(
      (u) => u.last_login && toLocalDateString(new Date(u.last_login)) === todayKey,
    ).length;
    const auditEventsToday = auditEntries.filter(
      (a) => toLocalDateString(new Date(a.timestamp)) === todayKey,
    ).length;
    // Role mix, shortened -- "1 dentist · 1 aide · 3 staff" says more about the
    // account list than the bare total does.
    const ROLE_SHORT: Record<string, string> = {
      dentist: 'dentist', dental_aide: 'aide', school_admin: 'school admin',
      bho_staff: 'BHO', system_admin: 'admin',
    };
    const roleMix = Object.entries(
      users.filter((u) => !u.isArchived).reduce<Record<string, number>>((acc, u) => {
        const key = ROLE_SHORT[u.role] ?? u.role;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${n} ${role}${n !== 1 && !role.endsWith('s') ? 's' : ''}`)
      .join(' · ');
    const busiestModule = [...auditEntries.filter((a) => toLocalDateString(new Date(a.timestamp)) === todayKey)
      .reduce<Map<string, number>>((m, a) => m.set(a.affected_model, (m.get(a.affected_model) ?? 0) + 1), new Map())
      .entries()].sort((a, b) => b[1] - a[1])[0];

    // Real, computed from users' last_login timestamps -- an approximation
    // (one login per user per day, not a full session log) but genuinely
    // real, not fabricated.
    const loginActivityData = (() => {
      const days: { key: string; label: string }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({ key: toLocalDateString(d), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
      }
      return days.map(({ key, label }) => ({
        day: label,
        logins: users.filter((u) => u.last_login && toLocalDateString(new Date(u.last_login)) === key).length,
      }));
    })();

    // Real, computed from actual audit trail entries.
    const actionsByModuleData = (() => {
      const counts = new Map<string, number>();
      for (const a of auditEntries) {
        counts.set(a.affected_model, (counts.get(a.affected_model) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([module, actions]) => ({ module, actions }));
    })();

    // Real, 5 most recent audit trail entries.
    const userNameById = new Map(users.map((u) => [u._id, u.full_name]));
    const recentAudit = [...auditEntries]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5)
      .map((a) => ({
        time: new Date(a.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        user: userNameById.get(a.user_id) ?? 'Unknown User',
        action: a.action,
        module: a.affected_model,
      }));

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4 rise">
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">System monitoring and management</p>
          </div>
          {/* Date + active-user count moved into the system summary (Sprint I). */}
          <Link
            to="/accounts"
            className="ml-auto inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-lg hover:bg-primary-hover transition-colors"
          >
            <Users className="w-4 h-4" />
            Manage Accounts
          </Link>
        </div>

        {/* System summary (Sprint I). No 3a mock exists for this role — it was
            excluded from the design work because three of its four tiles read
            literal "N/A", and a ruled strip would have presented three
            absences as if they were readings. Replaced with four figures the
            system actually holds; uptime and failed logins are still not
            measured anywhere, so they are simply gone rather than shown empty. */}
        <div className="bg-card border border-border rounded-sm overflow-hidden rise rise-1">
          <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 bg-muted border-b border-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-foreground">System summary</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatDateWithWeekday(new Date())}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <SummaryCell
              icon={Users}
              label="Active users"
              value={String(activeUsersCount)}
              context={roleMix || 'No active accounts'}
              linkTo="/accounts"
              loading={extraLoading}
            />
            <SummaryCell
              icon={CheckCircle}
              label="Signed in today"
              value={String(signedInTodayCount)}
              context={`of ${activeUsersCount} active`}
              linkTo="/audit"
              loading={extraLoading}
            />
            <SummaryCell
              icon={Activity}
              label="Audit events today"
              value={String(auditEventsToday)}
              context={busiestModule ? `Most in ${busiestModule[0]}` : 'No activity recorded today'}
              linkTo="/audit"
              loading={extraLoading}
            />
            <SummaryCell
              icon={Clock}
              label="Archived accounts"
              value={String(archivedUsersCount)}
              context={archivedUsersCount > 0 ? 'Restorable from Accounts' : 'None archived'}
              linkTo="/accounts"
              loading={extraLoading}
            />
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 rise rise-2">
          {/* Login Activity - Line Chart (real, from users' last_login) */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">Login Activity (Last 7 Days)</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Users seen per day, from last-login timestamps</p>
            <ChartBody ready={!extraLoading}>
            <ResponsiveContainer width="100%" height={220} key="login-activity-container">
              <LineChart data={loginActivityData} id="login-activity-chart">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} key="login-grid" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} key="login-xaxis" />
                <YAxis tick={{ fontSize: 12 }} key="login-yaxis" allowDecimals={false} />
                <Tooltip key="login-tooltip" content={<ChartTooltip />} />
                <Line type="monotone" dataKey="logins" stroke={CHART.brand} strokeWidth={2} dot={{ r: 5 }} key="login-line" />
              </LineChart>
            </ResponsiveContainer>
            </ChartBody>
          </div>

          {/* Actions by Module - Horizontal Bar Chart (real, from audit trail) */}
          <div className="bg-card p-4 rounded-xl border border-border">
            <h2 className="text-sm font-bold text-foreground mb-0.5">Actions by Module</h2>
            <p className="text-[11px] text-muted-foreground mb-3">Audit-trail entries per data model · last {AUDIT_WINDOW_DAYS} days</p>
            <ChartBody ready={!extraLoading}>
            {actionsByModuleData.length === 0 ? (
              <NoDataYet message="No audit trail activity recorded yet." />
            ) : (
              <ResponsiveContainer width="100%" height={220} key="actions-module-container">
                <BarChart data={actionsByModuleData} layout="vertical" id="actions-module-chart">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART.grid} key="actions-grid" />
                  <XAxis type="number" tick={{ fontSize: 12 }} key="actions-xaxis" allowDecimals={false} />
                  <YAxis dataKey="module" type="category" width={100} tick={{ fontSize: 12 }} key="actions-yaxis" />
                  <Tooltip key="actions-tooltip" content={<ChartTooltip />} />
                  <Bar dataKey="actions" fill={CHART.brand} key="actions-bar" />
                </BarChart>
              </ResponsiveContainer>
            )}
            </ChartBody>
          </div>
        </div>

        {/* Recent Audit Activity (real) */}
        <div className="bg-card p-4 rounded-xl border border-border rise rise-3">
          <h2 className="text-sm font-bold text-foreground mb-0.5">Recent Audit Activity</h2>
          <p className="text-[11px] text-muted-foreground mb-3">Five most recent recorded actions</p>
          <ChartBody ready={!extraLoading}>
          {recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No audit trail activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {recentAudit.map((log, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{log.time}</span>
                      <span className="font-medium text-foreground">{log.user}</span>
                      <span className="text-sm text-muted-foreground">• {log.action}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Module: {log.module}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </ChartBody>
          <Link
            to="/audit"
            className="block mt-4 text-center text-sm text-primary hover:text-primary font-medium"
          >
            View Full Audit Trail →
          </Link>
        </div>
      </div>
    );
  }

  // Default fallback
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back, {user?.name}</p>
      </div>
      <div className="bg-card p-4 rounded-xl border border-border">
        <p className="text-muted-foreground">No dashboard configured for your role.</p>
      </div>
    </div>
  );
};