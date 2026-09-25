import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Search, X, CheckCircle, AlertCircle, Shield, School as SchoolIcon, List, ChevronLeft, ChevronRight, ChevronUp, Eye, Users, ChevronDown } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { treatmentCodes, treatmentLabel } from '../utils/dentalChartCodes';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { PAGE_SIZE_OPTIONS } from './Pagination';
import { formatDate, formatMonthYear } from '../utils/localDate';
import { TOPBAR_H } from '../utils/layout';
import { PageHeader } from './PageHeader';
import { schoolYearLabel } from '../utils/schoolYear';

const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];

// The "resting" school year for this page's default view (user, 2026-09-25):
// a pupil whose Visit 2 just got recorded was disappearing from the default
// list because the OLD default combined 'outstanding' status with 'all'
// years, and 'outstanding' hides a completed pair. The fix scopes the
// default to the CURRENT school year instead -- that is what "School Year"
// filter is actually for, going BACK to see other years -- and shows every
// status within it, completed pairs included.
const CURRENT_SCHOOL_YEAR = schoolYearLabel();

// "Hide" (user, 2026-09-25): 0 is the sentinel -- useRPCTracking already
// treats a falsy limit as "no limit" (see filterRpcRows), so this needs no
// new backend concept, just a page size that isn't sent. It shows every row
// AND hides the whole footer bar (Showing.../Items per page), so the table
// flows to fill the space that bar used to take -- a thin reveal tab at the
// bottom brings the footer back (see the footer render below). Kept OUT of
// the shared PAGE_SIZE_OPTIONS: PatientList's usePagination divides by
// pageSize to slice client-side, and a 0 there would divide by zero.
const HIDE_FOOTER = 0;
const RPC_PAGE_SIZE_OPTIONS = [...PAGE_SIZE_OPTIONS, HIDE_FOOTER] as const;


const ViewToggle = ({ mode, onChange }: { mode: 'school' | 'list'; onChange: (m: 'school' | 'list') => void }) => (
  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
    <button onClick={() => onChange('school')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'school' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      <SchoolIcon className="w-4 h-4" /> School View
    </button>
    <button onClick={() => onChange('list')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'list' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      <List className="w-4 h-4" /> List View
    </button>
  </div>
);

export const RPCTracking = () => {
  const { selectedSchool, user } = useAuth();
  const navigate = useNavigate();

  const [drillSchool, setDrillSchool] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState('all');
  // Defaults to 'all', not 'outstanding' (user, 2026-09-25): see
  // CURRENT_SCHOOL_YEAR above -- a completed Visit 1 + Visit 2 pair stays
  // visible in the default view instead of vanishing the moment it's done.
  const [statusFilter, setStatusFilter] = useState('all');
  const [treatmentFilter, setTreatmentFilter] = useState('all');
  const [schoolYearFilter, setSchoolYearFilter] = useState(CURRENT_SCHOOL_YEAR);
  // Defaults to 'date_desc', not 'all' (user, 2026-09-25): a worklist reads
  // newest activity first, so the most recently treated pupils lead. 'all'
  // stays selectable from the dropdown for the plain alphabetical order.
  const [sortFilter, setSortFilter] = useState('date_desc');

  // ── Sprint 146: FILTERED AND PAGED ON THE SERVER ────────────────────────
  //
  // ⚠ Every filter moved together, including the SCHOOL context. Paging the
  // query while one stayed here would have filtered only the visible page —
  // and a page count describing a roll the user is not looking at.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const {
    records: rpcRecords,
    total,
    schoolTotal,
    sectionOptions,
    schoolYearOptions,
    loading,
    error,
  } = useRPCTracking({
    q: searchTerm,
    school: selectedSchool ?? undefined,
    grade: gradeFilter,
    section: sectionFilter,
    gender: genderFilter,
    ageGroup: ageGroupFilter,
    status: statusFilter,
    treatment: treatmentFilter,
    schoolYear: schoolYearFilter,
    sort: sortFilter,
    limit: pageSize === HIDE_FOOTER ? undefined : pageSize,
    offset: pageSize === HIDE_FOOTER ? 0 : (page - 1) * pageSize,
  });

  // Back to page 1 on any filter change — a narrowed filter can otherwise
  // leave the user on a page that no longer exists, looking at nothing.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSchool, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, statusFilter, treatmentFilter, schoolYearFilter, sortFilter]);

  const pageCount = pageSize === HIDE_FOOTER ? 1 : Math.max(1, Math.ceil(total / pageSize));
  // Changing page size keeps you near the same records rather than dumping you
  // back to the top — the same rule usePagination applied.
  const changePageSize = (next: number) => {
    if (next === HIDE_FOOTER) { setPageSize(next); setPage(1); return; }
    const firstRow = pageSize === HIDE_FOOTER ? 0 : (page - 1) * pageSize;
    setPageSize(next);
    setPage(Math.floor(firstRow / next) + 1);
  };

  // ⚠ The local `calculateAge`/`getAgeGroup` copies were deleted in Sprint 146.
  // They were a THIRD copy of the DOH age brackets — `shared/age.ts` says in
  // its own header that a second copy is how two screens disagree about a
  // 9-year-old, and the filter that used them now runs on the server anyway.



  // Already filtered and paged by the server (Sprint 146).
  const filtered = rpcRecords;

  // Pins the title and the search/filter card at the top (stacked below
  // TOPBAR_H, the fixed status strip — same pattern as PatientList's
  // toolbar/header), so ONLY the table below them can ever scroll, even if
  // the filter row wraps to more lines at a narrow width. Heights are
  // measured rather than hardcoded for that same reason.
  const titleRef = useRef<HTMLDivElement | null>(null);
  const filterCardRef = useRef<HTMLDivElement | null>(null);
  const [stickyTop, setStickyTop] = useState({ title: TOPBAR_H, filters: TOPBAR_H });

  // ⚠ BUG FIX (user, 2026-09-25): this used to run with `[]` deps, so it
  // measured titleRef ONCE -- during the very first render, while `loading`
  // is still true and the component returns the skeleton below instead of
  // the real title. titleRef.current is null at that moment, so titleH
  // came out 0 and never got corrected (the ResizeObserver.observe() calls
  // were skipped too, for the same null-ref reason), leaving the filter
  // bar's sticky offset stuck at TOPBAR_H forever -- same as the title's own
  // offset, so once both stuck on scroll, the filter card overlapped and
  // covered the bottom of "Routine Preventive Care". Re-running this when
  // `loading` flips to false re-measures against the now-mounted real
  // title and reattaches the observer to it.
  useEffect(() => {
    const measure = () => {
      const titleH = titleRef.current?.offsetHeight ?? 0;
      setStickyTop({ title: TOPBAR_H, filters: TOPBAR_H + titleH });
    };
    measure();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      if (titleRef.current) resizeObserver.observe(titleRef.current);
      if (filterCardRef.current) resizeObserver.observe(filterCardRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [loading]);

  // Bounds the row list to whatever viewport space is left below it and
  // above the footer, so a short page of results still fills that space
  // (fixed height, not max-height) instead of leaving a gray gap of bare
  // page underneath the card — same pattern as PatientList's Students table.
  const rowsWrapRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [rowsHeight, setRowsHeight] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      if (!rowsWrapRef.current) return;
      const top = rowsWrapRef.current.getBoundingClientRect().top;
      const footerH = footerRef.current?.offsetHeight ?? 0;
      setRowsHeight(Math.max(window.innerHeight - top - footerH, 160));
    };
    measure();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      if (footerRef.current) resizeObserver.observe(footerRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [filtered.length, pageCount, pageSize]);

  // Trims any stray page scroll the estimate above leaves behind (e.g.
  // <main>'s own bottom padding), the same correction pass PatientList uses.
  useLayoutEffect(() => {
    if (rowsHeight == null) return;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow > 0) {
      setRowsHeight((h) => (h == null ? h : Math.max(h - overflow, 160)));
    }
  }, [rowsHeight]);


  // sectionFilter was missing from both of these — an active section filter
  // neither lit up "Clear All" nor got cleared by it.
  // statusFilter and schoolYearFilter are each compared against their OWN
  // resting value ('all' and CURRENT_SCHOOL_YEAR), not the shared array's
  // 'all' check — treating them like the others would light up "Clear All"
  // permanently on page load and make Clear All widen the list instead of
  // resetting it.
  const hasActiveFilters = [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, treatmentFilter].some(f => f !== 'all') || statusFilter !== 'all' || schoolYearFilter !== CURRENT_SCHOOL_YEAR || sortFilter !== 'date_desc' || searchTerm !== '';
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setGenderFilter('all'); setAgeGroupFilter('all'); setStatusFilter('all'); setTreatmentFilter('all'); setSchoolYearFilter(CURRENT_SCHOOL_YEAR); setSortFilter('date_desc'); setSearchTerm(''); };

  const statusConfig: Record<string,{label:string;color:string;bg:string}> = {
    complete:     { label:'Complete',     color:'text-green-700', bg:'bg-green-100' },
    pending:      { label:'Visit 1 Only', color:'text-blue-700',  bg:'bg-blue-100'  },
    overdue:      { label:'Overdue',      color:'text-red-700',   bg:'bg-red-100'   },
    'not-started':{ label:'Not Started',  color:'text-muted-foreground',  bg:'bg-gray-100'  },
  };

  const FS = ({ value, onChange, opts, label }: any) => (
    <select value={value} onChange={e=>onChange(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
      <option value="all">{label}</option>
      {opts.map((o:any) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );

  // A native <select> always shows the CURRENT selection as its own text,
  // which is right for "All Grades" etc. RPC Status and Sort Order need the
  // opposite: the button always reads the filter's NAME, and the chosen
  // option shows only inside the open menu (checked) — so it needs its own
  // little menu rather than FS above.
  const PinnedLabelSelect = ({ value, onChange, opts, label }: { value: string; onChange: (v: string) => void; opts: { v: string; l: string }[]; label: string }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    return (
      <div ref={ref} className="relative">
        <button type="button" role="combobox" aria-haspopup="listbox" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-normal border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-ring">
          {label} <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 min-w-[190px] rounded-lg border border-border bg-card shadow-md py-1">
            {opts.map(o => (
              <button key={o.v} type="button" onClick={() => { onChange(o.v); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-canvas ${value === o.v ? 'text-primary font-semibold' : 'text-foreground'}`}>
                {o.l}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
      )}
      {/* No export by design (2026-09-02) — see PatientList for the reasoning:
          a CSV of named students leaves the encrypted store as plaintext.
          The DOH report on Reports is the official, aggregate output. */}
      <div ref={titleRef} className="sticky z-40 bg-gray-50 pb-2" style={{ top: stickyTop.title }}>
        <PageHeader
          icon={Shield}
          eyebrow="Clinical Care"
          title="Routine Preventive Care"
          description="Track each student's two required RPC visits per school year and flag the ones due or overdue."
        />
      </div>

      <div ref={filterCardRef} className="sticky z-40 bg-card rounded-xl border border-border p-4 space-y-3" style={{ top: stickyTop.filters }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search student..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="flex flex-wrap gap-2">
          <FS value={gradeFilter} onChange={g => { setGradeFilter(g); setSectionFilter('all'); }} label="All Grades" opts={GRADES.map(g=>({v:g,l:g}))} />
          <FS value={sectionFilter} onChange={setSectionFilter} label="All Sections" opts={sectionOptions.map(sec => ({ v: sec, l: sec }))} />
          <FS value={genderFilter} onChange={setGenderFilter} label="All Genders" opts={[{v:'Male',l:'Male'},{v:'Female',l:'Female'}]} />
          <FS value={ageGroupFilter} onChange={setAgeGroupFilter} label="All Age Groups" opts={[{v:'4 & below',l:'4 & below'},{v:'5-9',l:'5-9'},{v:'10-14',l:'10-14'},{v:'15-19',l:'15-19'},{v:'20 & above',l:'20 & above'}]} />
          {/* Button always reads "RPC Status"; the chosen option only shows
              inside the open menu (see PinnedLabelSelect above FS). */}
          <PinnedLabelSelect value={statusFilter} onChange={setStatusFilter} label="RPC Status" opts={[{v:'all',l:'All Statuses'},{v:'outstanding',l:'Outstanding only'},{v:'complete',l:'Both Complete'},{v:'pending',l:'Visit 1 Only'},{v:'overdue',l:'Overdue'},{v:'not-started',l:'Not Started'}]} />
          {/* .label only, never treatmentLabel() -- that appends the Tagalog
              local term (e.g. "Oral Prophylaxis (Linis)"), which stays on the
              clinical legend/chart but this filter is English-only. */}
          <FS value={treatmentFilter} onChange={setTreatmentFilter} label="All Treatments" opts={treatmentCodes.map(t=>({v:t.code,l:t.label}))} />
          {/* Narrows to pupils with an IPTR for that year — i.e. enrolled
              that year, the only school-year fact this join actually has
              (a visit isn't itself scoped to one). */}
          <FS value={schoolYearFilter} onChange={setSchoolYearFilter} label="All School Years" opts={schoolYearOptions.map(y=>({v:y,l:`SY ${y}`}))} />
          <PinnedLabelSelect value={sortFilter} onChange={setSortFilter} label="Sort Order" opts={[{v:'date_desc',l:'Latest Treatment First'},{v:'date_asc',l:'Oldest Treatment First'},{v:'all',l:'Name (A-Z)'}]} />
          {hasActiveFilters && <button onClick={clearFilters} title="Clear all filters" aria-label="Clear all filters" className="flex items-center justify-center p-2 text-destructive border border-red-200 rounded-lg hover:bg-red-50"><X className="w-4 h-4"/></button>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {/* Fixed height (not max-height), so THIS BOX is the only thing that
            ever scrolls -- the page itself never does, in either state (user,
            2026-09-25) -- and it always fills down to the footer. Column
            headings stick to the TOP OF THIS BOX via `sticky` on each `<th>`,
            not the `<tr>` (a sticky `<tr>` rendered as a duplicate mid-table
            in some browsers, see PatientList). "Hide" (pageSize ===
            HIDE_FOOTER) reuses this exact box: it just grows taller, because
            rowsHeight below measures against the short reveal tab instead of
            the full Showing/Items-per-page bar. */}
        <div ref={rowsWrapRef} className="overflow-auto" style={{ height: rowsHeight ?? undefined }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Student','Grade / Section','Visit 1','Visit 2','Status'].map(h => (
                  <th key={h} className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
                <th className="sticky top-0 z-10 bg-gray-100 text-left pl-4 pr-2 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Days Until Due</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left pl-2 pr-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">{hasActiveFilters ? <>No records match your filters. <button onClick={clearFilters} className="text-primary hover:underline font-medium">Clear filters</button></> : 'No RPC records for this school yet.'}</td></tr>
              ) : filtered.map(r => {
                const sc = statusConfig[r.status] || statusConfig['not-started'];
                const gc = getGradeColor(r.grade);
                // 4 calendar months after Visit 1 — the earliest of the DOH
                // 4–6 month window. Only meaningful once Visit 1 happened and
                // Visit 2 has not; everyone else gets the dash below.
                const dueDate = r.visit1Date && !r.visit2Date
                  ? (() => { const d = new Date(`${r.visit1Date}T00:00:00`); d.setMonth(d.getMonth() + 4); return d; })()
                  : null;
                return (
                  <tr key={r.id} className={`hover:bg-gray-50 transition-colors ${r.status==='overdue'?'bg-red-50':''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">{r.studentName.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
                        <span className="font-medium text-foreground">{r.studentName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold align-middle" style={{backgroundColor:gc.light,color:gc.solid}}>{r.grade}</span>
                      <span className="text-muted-foreground text-xs ml-1 align-middle">{r.section}</span>
                    </td>
                    <td className="px-4 py-3">{r.visit1Date ? <span className="text-green-700 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>{formatDate(r.visit1Date)}</span> : <span className="text-muted-foreground text-xs">Not done</span>}</td>
                    {/* "early" badge removed from view (user, 2026-09-25); r.earlyVisit2 is
    still computed server-side, just not shown here. */}
                    <td className="px-4 py-3">{r.visit2Date ? <span className="text-green-700 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>{formatDate(r.visit2Date)}</span> : <span className="text-muted-foreground text-xs flex flex-col items-start gap-1">Not done
                      {r.syCutoff === 'impossible' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold text-[10px]" title={`Even the earliest allowed Visit 2 (+4 months) falls after this school year ends (${r.syDeadline}) — it can't be counted for DOH/PhilHealth this school year`}>won't fit SY</span>}
                      {r.syCutoff === 'tight' && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-[10px]" title={`The 4–6 month window extends past the school year — Visit 2 must be done by ${r.syDeadline} to count for DOH/PhilHealth`}>by {r.syDeadline}</span>}
                    </span>}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.color}`}>{sc.label}</span></td>
                    <td className="pl-4 pr-2 py-3">
                      {dueDate ? (
                        <>
                          <div className="text-fuchsia-600 font-semibold text-xs">{formatMonthYear(dueDate)}</div>
                          <div className={r.status==='overdue' ? 'text-red-600 font-semibold text-xs' : 'text-muted-foreground text-xs'}>
                            {r.status==='overdue' ? `${Math.abs(r.daysUntilDue)}d overdue` : `${r.daysUntilDue}d`}
                          </div>
                        </>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="pl-2 pr-4 py-3 text-left">
                      <button
                        onClick={() => navigate(`/dental-chart/${r.id}?tab=treatments`)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-gray-50 whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" /> Open chart
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* "Hide" collapses the full Showing/Items-per-page bar to this
              thin reveal tab -- placed INSIDE the scrollable box, as the
              last row of its content, not pinned below it (user, 2026-09-25):
              it only comes into view once you've scrolled to the end of the
              list, same as any other row would. Not measured by rowsHeight
              either -- nothing sits below the box to reserve space for once
              Hide is on, so the box just fills the whole remaining viewport. */}
          {pageSize === HIDE_FOOTER && (
            <button
              type="button"
              onClick={() => changePageSize(25)}
              title="Show pagination controls"
              className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-canvas hover:text-foreground"
            >
              <ChevronUp className="h-3 w-3" /> Show pagination controls
            </button>
          )}
        </div>
        {pageSize !== HIDE_FOOTER && (
        <div ref={footerRef} className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              Showing <span className="font-semibold text-foreground">{total === 0 ? 0 : (page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-semibold text-foreground">{Math.min(page * pageSize, total)}</span> of{' '}
              <span className="font-semibold text-foreground">{total}</span> records
              {selectedSchool ? ` at ${selectedSchool}` : ''}
            </span>
            {/* Literal glyph, not a CSS-drawn bar (2026-09-25: matches
                Students/Dental Charts/Treatment's divider exactly). */}
            <span aria-hidden="true" className="hidden text-3xl font-thin leading-none align-middle text-gray-300 sm:inline-block">|</span>
            <div className="flex items-center gap-2">
              {/* theme.css's base `label` rule sets its own font-size/weight
                  (medium), which otherwise overrides the ancestor's text-sm —
                  a bare element selector always wins over inheritance, so
                  this needs its own explicit text-sm font-normal. */}
              <label htmlFor="rpc-page-size" className="whitespace-nowrap text-sm font-normal">Items per page</label>
              <select
                id="rpc-page-size"
                aria-label="Items per page"
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
                className="w-fit rounded-full border border-border bg-canvas px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {RPC_PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n === HIDE_FOOTER ? 'Hide' : n}</option>)}
              </select>
            </div>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="rounded-full bg-primary-surface px-3 py-1.5 text-sm font-semibold text-primary tabular-nums">{page} / {pageCount}</span>
              <button
                onClick={() => setPage(Math.min(pageCount, page + 1))}
                disabled={page === pageCount}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};
