import { useEffect, useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRiskClassification, type RiskCandidate } from '../hooks/useRiskClassification';
import { PageHeader } from './PageHeader';
import { AGE_GROUPS } from '../utils/age';
import { formatDate } from '../utils/localDate';
import { SkeletonStatGrid, SkeletonTable } from './Skeleton';
import { Notice } from './Notice';
import { RiskReviewDialog, LevelChip } from './risk/RiskReviewDialog';
import { displayLevel, type RiskReviewStatus } from '../../../shared/riskCandidates';
import { suggestTreatments } from '../../../shared/riskTreatments';

// Risk Classification (2026-10-01): the classmate's design, replacing the
// Sprint 21g queue + inline validation panel. Plan and decisions: HANDOFF
// "PLANNED: Risk Classification redesign".
//
// ⚠ What the list SHOWS as a pupil's risk is `displayLevel`: the dentist's
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
const PAGE_SIZE = 25;

interface ModelStatus {
  status: string;
  model: { display_name?: string; synthetic_data?: boolean };
}

function YesNo({ value }: { value: boolean }) {
  return value
    ? <span className="rounded-md bg-red-50 px-2 py-0.5 text-sm font-semibold text-red-700">Yes</span>
    : <span className="rounded-md bg-green-50 px-2 py-0.5 text-sm font-semibold text-green-700">No</span>;
}

function StatusChip({ c }: { c: RiskCandidate }) {
  if (c.status === 'needs_review') return <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-800">Needs review</span>;
  if (c.status === 'reviewed') {
    const at = c.history[c.history.length - 1]?.validatedAt;
    return <span className="whitespace-nowrap rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-sm font-semibold text-green-800">✓ Reviewed{at ? ` · ${formatDate(at)}` : ''}</span>;
  }
  if (c.status === 'not_checked') return <span className="whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm text-muted-foreground">Not checked yet</span>;
  return <span className="whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm text-muted-foreground">No visit yet</span>;
}

export const AIAnalytics = () => {
  const { user, selectedSchool } = useAuth();
  const isDentist = user?.role === 'dentist';

  // `?student=<id>` = one pupil, opened from the Students list's Risk card;
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [reviewing, setReviewing] = useState<RiskCandidate | null>(null);
  const [serviceDown, setServiceDown] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);

  // Any filter change goes back to page 1: page 3 of a smaller set may not exist.
  useEffect(() => { setPage(0); }, [tab, q, grade, risk, section, gender, ageGroup, sort, selectedSchool, studentId]);

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
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
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

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const notCheckedOnPage = useMemo(() => candidates.filter((c) => c.status === 'not_checked' && c.latestPreventiveId), [candidates]);

  // "Check risk" for the not-checked pupils ON THIS PAGE: ask the model, then
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

  const cards = [
    { label: 'Needs your review', value: statusCounts.needs_review, note: 'waiting for the dentist', tone: 'text-primary' },
    { label: 'High risk', value: counts.High, tone: 'text-red-600' },
    { label: 'Medium risk', value: counts.Medium, tone: 'text-amber-700' },
    { label: 'Low risk', value: counts.Low, tone: 'text-green-700' },
    { label: 'Not checked yet', value: statusCounts.not_checked, note: 'no result yet', tone: 'text-muted-foreground' },
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-border bg-card px-5 py-4">
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <div className={`mt-1 text-3xl font-bold tabular-nums ${c.tone}`}>{c.value}</div>
                {c.note && <div className="mt-1 text-xs text-muted-foreground">{c.note}</div>}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card">
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
            {/* Filters */}
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by student name"
                aria-label="Search by student name" className={`${selectCls} min-w-0 flex-1`} />
              <select value={grade} onChange={(e) => { setGrade(e.target.value); setSection('all'); }} aria-label="Grade" className={selectCls}>
                <option value="all">All grades</option>
                {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Risk level" className={selectCls}>
                <option value="all">All risk levels</option>
                <option value="High">High risk</option>
                <option value="Medium">Medium risk</option>
                <option value="Low">Low risk</option>
                <option value="Unassessed">No result yet</option>
              </select>
              <div className="relative">
                <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}
                  className={`${selectCls} inline-flex w-full items-center justify-between gap-2 sm:w-auto`}>
                  More filters <ChevronDown className="h-4 w-4" />
                </button>
                {moreOpen && (
                  <div className="absolute right-0 z-20 mt-2 w-64 space-y-2 rounded-xl border border-border bg-card p-3 shadow-lg">
                    <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" className={`${selectCls} w-full`}>
                      <option value="all">All sections</option>
                      {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Sex" className={`${selectCls} w-full`}>
                      <option value="all">Male and female</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)} aria-label="Age group" className={`${selectCls} w-full`}>
                      <option value="all">All ages</option>
                      {AGE_GROUPS.map((a) => <option key={a} value={a}>{a} years</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Tabs: scroll sideways on a phone */}
            <div className="overflow-x-auto border-b border-border">
              <div className="flex min-w-max gap-2 px-4">
                {TABS.map(({ key, label }) => {
                  const n = key === 'all' ? statusCounts.all : statusCounts[key];
                  const on = tab === key;
                  return (
                    <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={on}
                      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm ${on ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                      {label}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="text-muted-foreground">
                {sort === 'priority'
                  ? <>Listed in order: <strong className="text-foreground">most urgent first</strong> (High risk that needs review, then Medium, then the rest)</>
                  : <>Listed in order: <strong className="text-foreground">name, A to Z</strong></>}
              </div>
              <label className="flex items-center gap-2 text-muted-foreground">
                Order by
                <select value={sort} onChange={(e) => setSort(e.target.value as 'priority' | 'name')} className={selectCls}>
                  <option value="priority">Most urgent first</option>
                  <option value="name">Name, A to Z</option>
                </select>
              </label>
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
                  <tr className="bg-muted/60 text-left align-bottom text-xs font-semibold text-foreground">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Grade / Section</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-3 py-3 text-center">With caries experience</th>
                    <th className="px-3 py-3 text-center">In temporary teeth</th>
                    <th className="px-3 py-3 text-center">In permanent dentition</th>
                    <th className="px-3 py-3 text-center">With active caries</th>
                    <th className="px-3 py-3 text-center">Caries-free teeth</th>
                    <th className="px-3 py-3 text-center">Treatments</th>
                    <th className="px-4 py-3"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {candidates.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">No students match.</td></tr>
                  ) : candidates.map((c, i) => {
                    const lvl = displayLevel(c);
                    const charted = c.teeth.length > 0;
                    const toDecide = c.status === 'needs_review' ? suggestTreatments(c.teeth, c.suggestion?.level ?? null).length : null;
                    const canOpen = c.status === 'needs_review' || c.status === 'not_checked';
                    return (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs tabular-nums text-muted-foreground">{page * PAGE_SIZE + i + 1}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{[c.grade, c.section].filter(Boolean).join(' · ')}</td>
                        <td className="px-4 py-3">{lvl ? <LevelChip level={lvl} /> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3"><StatusChip c={c} /></td>
                        {charted ? (
                          <>
                            <td className="px-3 py-3 text-center"><YesNo value={c.caries.withCariesExperience} /></td>
                            <td className="px-3 py-3 text-center"><YesNo value={c.caries.inTemporaryTeeth} /></td>
                            <td className="px-3 py-3 text-center"><YesNo value={c.caries.inPermanentDentition} /></td>
                            <td className="px-3 py-3 text-center"><YesNo value={c.caries.withActiveCaries} /></td>
                            <td className="px-3 py-3 text-center tabular-nums">{c.caries.cariesFreeTeeth ?? '—'}</td>
                          </>
                        ) : (
                          <td colSpan={5} className="px-3 py-3 text-center text-muted-foreground">Not charted this school year</td>
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

            <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Showing {candidates.length} of {total} students</span>
              <div className="flex items-center gap-2">
                <span>Rows per page: {PAGE_SIZE} · Page {page + 1} of {pageCount}</span>
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page"
                  className="rounded-lg border border-border p-1 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} aria-label="Next page"
                  className="rounded-lg border border-border p-1 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
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
