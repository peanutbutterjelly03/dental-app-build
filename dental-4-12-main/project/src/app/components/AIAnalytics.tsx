import { useEffect, useMemo, useState } from 'react';
import { Brain, ChevronDown, CircleDashed, ChevronLeft, ChevronRight, ClipboardList, Loader2, ShieldAlert, SlidersHorizontal, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRiskClassification, type RiskCandidate } from '../hooks/useRiskClassification';
import { PageHeader } from './PageHeader';
import { AGE_GROUPS } from '../utils/age';
import { formatDate } from '../utils/localDate';
import { Pagination } from './Pagination';
import { SkeletonStatGrid, SkeletonTable } from './Skeleton';
import { Notice } from './Notice';
import { RiskReviewDialog, LevelChip } from './risk/RiskReviewDialog';
import { displayLevel, type RiskReviewStatus } from '../../../shared/riskCandidates';
import { suggestTreatments } from '../../../shared/riskTreatments';

// Risk Classification (2026-10-01): the classmate's design, replacing the
// Sprint 21g queue + inline validation panel. Plan and decisions: HANDOFF
// "PLANNED: Risk Classification redesign".
//
// ⚠ What the list SHOWS as a student's risk is `displayLevel`: the dentist's
// level once reviewed, the stored suggestion while it waits ("Needs review").
// Only this clinical screen shows suggestions; every report and dashboard
// reads validated results only (R1), which is what makes the banner's "nothing
// counts until the dentist reviews it" true.
//
// Kept from the old page on purpose: the prediction-service banner (the free
// ML host sleeps) and the SYNTHETIC-DATA banner, which CLAUDE.md requires until
// the model is retrained on real IPTR records.

type Tab = Exclude<RiskReviewStatus, 'no_visit'> | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'not_checked', label: 'Not checked yet' },
  { key: 'all', label: 'All students' },
];

interface ModelStatus {
  status: string;
  model: { display_name?: string; synthetic_data?: boolean };
}

function YesNo({ value }: { value: boolean }) {
  return value
    ? <span className="rounded-md bg-red-50 px-2 py-0.5 text-sm font-semibold text-red-700">Yes</span>
    : <span className="rounded-md bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">No</span>;
}

const LEVEL_TEXT = { High: 'text-red-700', Medium: 'text-amber-800', Low: 'text-green-800' } as const;

/** Risk level with its review status underneath, the same look as the Risk card on the Students list. */
function RiskCell({ c, level }: { c: RiskCandidate; level: keyof typeof LEVEL_TEXT | null }) {
  if (c.status === 'reviewed' && level) {
    const at = c.history[c.history.length - 1]?.validatedAt;
    return (
      <div className="flex flex-col items-start gap-0">
        <LevelChip level={level} small />
        <span className="whitespace-nowrap text-xs text-green-700">Reviewed{at ? ` · ${formatDate(at)}` : ''}</span>
      </div>
    );
  }
  if (c.status === 'needs_review') {
    return (
      <div className="flex flex-col items-start gap-0">
        <span className={`inline-flex items-center rounded-full border border-dashed border-current bg-card px-2 py-0.5 text-[12.5px] font-semibold ${level ? LEVEL_TEXT[level] : 'text-muted-foreground'}`}>{level ?? 'No level'}</span>
        <span className="whitespace-nowrap text-xs font-medium text-amber-800">Needs review</span>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-normal text-slate-500">
      <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
      {c.status === 'not_checked' ? 'Not checked' : 'No visit'}
    </span>
  );
}

export const AIAnalytics = () => {
  const { user, selectedSchool } = useAuth();
  const isDentist = user?.role === 'dentist';

  // `?student=<id>` = one student, opened from the Students list's Risk card;
  // `?tab=` = a tab to open on (the Notifications link). Read from the URL so
  // following either link while already on this page still takes effect.
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = searchParams.get('student') ?? '';
  const urlTab = TABS.find((t) => t.key === searchParams.get('tab'))?.key;
  const [tab, setTab] = useState<Tab>(studentId ? 'all' : urlTab ?? 'needs_review');
  useEffect(() => {
    if (studentId) setTab('all');
    else if (urlTab) setTab(urlTab);
  }, [studentId, urlTab]);
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('all');
  const [risk, setRisk] = useState('all');
  const [section, setSection] = useState('all');
  const [gender, setGender] = useState('all');
  const [ageGroup, setAgeGroup] = useState('all');
  const [sort, setSort] = useState<'priority' | 'name'>('priority');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reviewing, setReviewing] = useState<RiskCandidate | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);

  // Any filter change goes back to page 1: page 3 of a smaller set may not exist.
  useEffect(() => { setPage(0); }, [tab, q, grade, risk, section, gender, ageGroup, sort, selectedSchool, studentId, pageSize]);

  const { candidates, total, counts, statusCounts, gradeOptions, sectionOptions, loading, error, reload } = useRiskClassification({
    q,
    studentId,
    school: selectedSchool ?? '',
    grade,
    section,
    risk,
    gender,
    ageGroup,
    sort,
    status: tab,
    limit: pageSize,
    offset: page * pageSize,
  });

  // The free-tier ML service sleeps after ~15 min idle and takes 30-60 s to
  // wake; this probe is what wakes it. One failure must not declare it dead:
  // keep retrying (~2 min) and clear the banner the moment it answers.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const check = () => {
      apiClient.get<ModelStatus>('/predictions/status')
        .then((s) => { if (!cancelled) { setModelStatus(s); setServiceDown(false); } })
        .catch(() => {
          if (cancelled) return;
          setServiceDown(true);
          if (attempts++ < 8) setTimeout(check, 15000);
        });
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const notCheckedOnPage = useMemo(() => candidates.filter((c) => c.status === 'not_checked' && c.latestPreventiveId), [candidates]);

  // "Check risk" for the not-checked students ON THIS PAGE: ask the model, then
  // STORE each answer as an unreviewed suggestion. Sequential on purpose: the
  // free ML host handles one request at a time, and the progress stays honest.
  const checkVisible = async () => {
    const list = notCheckedOnPage;
    setBulk({ done: 0, total: list.length, failed: 0 });
    let failed = 0;
    for (const [i, c] of list.entries()) {
      try {
        const result = await apiClient.post<{ risk_level: 'High' | 'Medium' | 'Low'; confidence: number; recommendation: string }>(
          '/predictions/assess', { student_id: c.id, features: c.features });
        await apiClient.post('/risk-stratifications', {
          preventive_id: c.latestPreventiveId,
          risk_level: result.risk_level,
          recommendation: result.recommendation ?? '',
          dmf_score: c.features.dmf_score,
          dmf_index: c.dmfIndex,
          validated_by_dentist: false,
          model_risk_level: result.risk_level,
          model_confidence: result.confidence,
        });
      } catch {
        failed++;
      }
      setBulk({ done: i + 1, total: list.length, failed });
    }
    await reload();
    setBulk((b) => (b && b.failed ? b : null));
  };

  const cards: { label: string; value: number; note?: string; tone: string; icon: LucideIcon; bg: string; fg: string }[] = [
    { label: 'Needs your review', value: statusCounts.needs_review, note: 'waiting for the dentist', tone: 'text-primary', icon: ClipboardList, bg: '#E8ECF6', fg: '#273A78' },
    { label: 'High risk', value: counts.High, tone: 'text-red-600', icon: TriangleAlert, bg: '#FEE2E2', fg: '#DC2626' },
    { label: 'Medium risk', value: counts.Medium, tone: 'text-amber-700', icon: ShieldAlert, bg: '#FEF3C7', fg: '#B45309' },
    { label: 'Low risk', value: counts.Low, tone: 'text-green-700', icon: ShieldCheck, bg: '#DCFCE7', fg: '#15803D' },
    { label: 'Not checked yet', value: statusCounts.not_checked, note: 'no result yet', tone: 'text-muted-foreground', icon: CircleDashed, bg: '#F1F5F9', fg: '#64748B' },
  ];

  const selectCls = 'rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Brain}
        eyebrow="Clinical Care"
        title="Risk Classification"
        description="Check each student's cavity risk, review it, and confirm the treatments that follow."
      />

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>Computer-assisted screening, not a diagnosis.</strong> The system only suggests. Nothing counts
        until the dentist reviews it, and every step is saved in the audit trail.
      </div>

      {serviceDown && (
        <Notice variant="warning">
          The prediction service is not responding. It sleeps when idle and usually wakes within a minute; this
          page keeps checking. Reviews of results already on record work as normal.
        </Notice>
      )}
      {modelStatus?.model?.synthetic_data && (
        <Notice variant="warning">
          <span>
            The current model ({modelStatus.model.display_name}) was trained on <strong>synthetic placeholder
            data</strong>. Its suggestions are for demonstration and pipeline testing only until it is retrained
            on real IPTR records.
          </span>
        </Notice>
      )}

      {loading && candidates.length === 0 ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading students">
          <SkeletonStatGrid count={5} />
          <SkeletonTable rows={6} />
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.label} title={c.note} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <span style={{ backgroundColor: c.bg, color: c.fg }} className="mb-4 grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-bold text-foreground">{c.label}</div>
                    <div className={`mt-1 text-[22px] font-extrabold leading-none tabular-nums ${c.tone}`}>{c.value}</div>
                    <div className="mt-0.5 text-[10px] font-thin text-muted-foreground">{c.value === 1 ? 'student' : 'students'}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="h-1.5 bg-yellow-600" aria-hidden="true" />
            {studentId && (
              <div className="flex flex-col gap-2 border-b border-border bg-primary-surface px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="text-foreground">
                  Showing <strong>{candidates[0]?.name ?? 'one student'}</strong> from the Students list.{' '}
                  <button type="button" onClick={() => setSearchParams({})} className="font-semibold text-primary hover:underline">
                    Show all students
                  </button>
                </div>
                <Link to="/patients"className="font-semibold text-primary hover:underline">← Back to Students</Link>
              </div>
            )}
            {/* Tabs on the left; search and one Filters button on the right. */}
            <div className="flex flex-col gap-2 border-b-2 border-slate-200 px-4 pt-2 lg:flex-row lg:items-end lg:justify-between">
              <div className="-mb-0.5 flex min-w-0 gap-6 overflow-x-auto">
                {TABS.map(({ key, label }) => {
                  const n = key === 'all' ? statusCounts.all : statusCounts[key];
                  const on = tab === key;
                  return (
                    <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={on}
                      className={`whitespace-nowrap border-b-[3px] px-0.5 py-3 text-[15px] font-bold ${on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                      {label}<span className="ml-1.5 text-[13px] font-normal text-muted-foreground tabular-nums">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative flex flex-wrap items-center gap-2 pb-2">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by student name"
                  aria-label="Search by student name" className={`${selectCls} min-w-0 flex-1 lg:w-64 lg:flex-none`} />
                <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-primary">
                    {[grade, risk, section, gender, ageGroup].filter((v) => v !== 'all').length}
                  </span>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full z-20 mt-2 w-72 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-lg">
                    <label className="block text-sm font-semibold text-foreground">Grade
                      <select value={grade} onChange={(e) => { setGrade(e.target.value); setSection('all'); }} aria-label="Grade" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="all">All grades</option>
                        {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-foreground">Risk level
                      <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk level" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="all">All risk levels</option>
                        <option value="High">High risk</option>
                        <option value="Medium">Medium risk</option>
                        <option value="Low">Low risk</option>
                        <option value="Unassessed">No result yet</option>
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-foreground">Section
                      <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="all">All sections</option>
                        {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-foreground">Sex
                      <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Sex" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="all">Male and female</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-foreground">Age group
                      <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} aria-label="Age group" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="all">All ages</option>
                        {AGE_GROUPS.map((a) => <option key={a} value={a}>{a} years</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-semibold text-foreground">Order by
                      <select value={sort} onChange={(e) => setSort(e.target.value as 'priority' | 'name')} aria-label="Order by" className={`${selectCls} mt-1 w-full font-normal`}>
                        <option value="priority">Most urgent first</option>
                        <option value="name">Name, A to Z</option>
                      </select>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {sort === 'priority'
                        ? 'Most urgent first: High risk that needs review, then Medium, then the rest.'
                        : 'Listed by name, A to Z.'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {tab === 'not_checked' && isDentist && notCheckedOnPage.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm">
                <button type="button" onClick={checkVisible} disabled={bulk !== null && bulk.done < bulk.total || serviceDown}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
                  {bulk && bulk.done < bulk.total && <Loader2 className="h-4 w-4 animate-spin" />}
                  Check risk for the {notCheckedOnPage.length} on this page
                </button>
                {bulk && <span className="text-muted-foreground">Checked {bulk.done} of {bulk.total}{bulk.failed ? `, ${bulk.failed} could not be checked (try again)` : ''}</span>}
              </div>
            )}

            {/* Table: scrolls inside its own container on narrow screens */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left align-bottom text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th rowSpan={2} className="px-4 py-3">#</th>
                    <th rowSpan={2} className="px-4 py-3">Student</th>
                    <th rowSpan={2} className="px-4 py-3">Risk</th>
                    <th colSpan={5} className="border-b border-border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-foreground">Caries Experience</th>
                    <th rowSpan={2} className="px-3 py-3 text-center">Treatments</th>
                    <th rowSpan={2} className="px-4 py-3 text-right">Actions</th>
                  </tr>
                  <tr className="bg-gray-100 text-left align-bottom text-[12px] font-normal normal-case tracking-normal text-muted-foreground">
                    <th className="px-3 py-2 text-left font-normal">With Caries Experience</th>
                    <th className="px-3 py-2 text-left font-normal">With Caries Experience in Temporary Teeth</th>
                    <th className="px-3 py-2 text-left font-normal">With Caries Experience in Permanent Dentition</th>
                    <th className="px-3 py-2 text-left font-normal">With Active Dental Caries</th>
                    <th className="px-3 py-2 text-left font-normal">Number of Caries Free Teeth</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">No students match.</td></tr>
                  ) : candidates.map((c, i) => {
                    const lvl = displayLevel(c);
                    const charted = c.teeth.length > 0;
                    const toDecide = c.status === 'needs_review' ? suggestTreatments(c.teeth, c.suggestion?.level ?? null).length : null;
                    const canOpen = c.status === 'needs_review' || c.status === 'not_checked';
                    return (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs tabular-nums text-muted-foreground">{page * pageSize + i + 1}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                        <td className="px-4 py-3"><RiskCell c={c} level={lvl} /></td>
                        {charted ? (
                          <>
                            <td className="px-3 py-3 text-left"><YesNo value={c.caries.withCariesExperience} /></td>
                            <td className="px-3 py-3 text-left"><YesNo value={c.caries.inTemporaryTeeth} /></td>
                            <td className="px-3 py-3 text-left"><YesNo value={c.caries.inPermanentDentition} /></td>
                            <td className="px-3 py-3 text-left"><YesNo value={c.caries.withActiveCaries} /></td>
                            <td className="px-3 py-3 text-left tabular-nums">{c.caries.cariesFreeTeeth ?? '—'}</td>
                          </>
                        ) : (
                          <td colSpan={5} className="px-3 py-3 text-left text-muted-foreground">Not charted this school year</td>
                        )}
                        <td className="px-3 py-3 text-center text-foreground">
                          {toDecide !== null ? `${toDecide} to decide` : c.status === 'reviewed' ? 'Decided' : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canOpen && (
                            <button type="button" onClick={() => setReviewing(c)}
                              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-hover">
                              {!isDentist ? 'View' : c.status === 'needs_review' ? 'Review' : 'Check'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-border px-4 py-3">
              <Pagination
                page={page + 1}
                pageCount={pageCount}
                pageSize={pageSize}
                from={total === 0 ? 0 : page * pageSize + 1}
                to={page * pageSize + candidates.length}
                total={total}
                onPage={(p) => setPage(p - 1)}
                onPageSize={(n) => setPageSize(n)}
                noun="students"
                detail={selectedSchool ? `at ${selectedSchool}` : undefined}
              />
            </div>
          </div>
        </>
      )}

      {reviewing && (
        <RiskReviewDialog
          candidate={reviewing}
          canSave={isDentist}
          serviceDown={serviceDown}
          onClose={() => setReviewing(null)}
          onSaved={() => { void reload(); }}
        />
      )}
    </div>
  );
};
