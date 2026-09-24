import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Search, X, CheckCircle, AlertCircle, Clock, Shield, School as SchoolIcon, List, ChevronRight, Users } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { treatmentCodes, treatmentLabel } from '../utils/dentalChartCodes';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { Pagination, usePagination } from './Pagination';
import { formatDate } from '../utils/localDate';

const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];


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
  // Defaults to 'outstanding', not 'all': this page is a worklist, so it opens
  // on the students who still need a visit. Completed records are opt-in via
  // the Status filter rather than padding the list with finished work.
  const [statusFilter, setStatusFilter] = useState('outstanding');
  const [treatmentFilter, setTreatmentFilter] = useState('all');
  const [schoolYearFilter, setSchoolYearFilter] = useState('all');

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
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  // Back to page 1 on any filter change — a narrowed filter can otherwise
  // leave the user on a page that no longer exists, looking at nothing.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSchool, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, statusFilter, treatmentFilter, schoolYearFilter]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Changing page size keeps you near the same records rather than dumping you
  // back to the top — the same rule usePagination applied.
  const changePageSize = (next: number) => {
    const firstRow = (page - 1) * pageSize;
    setPageSize(next);
    setPage(Math.floor(firstRow / next) + 1);
  };

  // ⚠ The local `calculateAge`/`getAgeGroup` copies were deleted in Sprint 146.
  // They were a THIRD copy of the DOH age brackets — `shared/age.ts` says in
  // its own header that a second copy is how two screens disagree about a
  // 9-year-old, and the filter that used them now runs on the server anyway.



  // Already filtered and paged by the server (Sprint 146).
  const filtered = rpcRecords;


  // sectionFilter was missing from both of these — an active section filter
  // neither lit up "Clear All" nor got cleared by it.
  // statusFilter is compared against 'outstanding', not 'all': that is now its
  // resting value, so treating it like the others would light up "Clear All"
  // permanently and make Clear All widen the list instead of resetting it.
  const hasActiveFilters = [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, treatmentFilter, schoolYearFilter].some(f => f !== 'all') || statusFilter !== 'outstanding' || searchTerm !== '';
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setGenderFilter('all'); setAgeGroupFilter('all'); setStatusFilter('outstanding'); setTreatmentFilter('all'); setSchoolYearFilter('all'); setSearchTerm(''); };

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">RPC Records</h1>
          <p className="text-sm text-muted-foreground">Routine Preventive Care — Fluoride application tracking (2nd fluoride dose due 4–6 months after Visit 1; other treatments may be done anytime)</p>
        </div>
        {/* No export by design (2026-09-02) — see PatientList for the reasoning:
            a CSV of named students leaves the encrypted store as plaintext.
            The DOH report on Reports is the official, aggregate output. */}
      </div>

      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
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
          {/* 'outstanding' is listed first and is the default — FS renders its
              `label` as the value-'all' option, so without an explicit entry
              here the select would have no option matching its own value. */}
          <FS value={statusFilter} onChange={setStatusFilter} label="All Statuses (incl. complete)" opts={[{v:'outstanding',l:'Outstanding only'},{v:'complete',l:'Both Complete'},{v:'pending',l:'Visit 1 Only'},{v:'overdue',l:'Overdue'},{v:'not-started',l:'Not Started'}]} />
          <FS value={treatmentFilter} onChange={setTreatmentFilter} label="All Treatments" opts={treatmentCodes.map(t=>({v:t.code,l:treatmentLabel(t)}))} />
          {/* Narrows to pupils with an IPTR for that year — i.e. enrolled
              that year, the only school-year fact this join actually has
              (a visit isn't itself scoped to one). */}
          <FS value={schoolYearFilter} onChange={setSchoolYearFilter} label="All School Years" opts={schoolYearOptions.map(y=>({v:y,l:`SY ${y}`}))} />
          {hasActiveFilters && <button onClick={clearFilters} title="Clear all filters" aria-label="Clear all filters" className="flex items-center justify-center p-2 text-destructive border border-red-200 rounded-lg hover:bg-red-50"><X className="w-4 h-4"/></button>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                {['Student','Grade / Section','Visit 1','Visit 2','Status','Days Until Due'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">{hasActiveFilters ? <>No records match your filters. <button onClick={clearFilters} className="text-primary hover:underline font-medium">Clear filters</button></> : 'No RPC records for this school yet.'}</td></tr>
              ) : filtered.map(r => {
                const sc = statusConfig[r.status] || statusConfig['not-started'];
                const gc = getGradeColor(r.grade);
                // daysUntilDue only means something once Visit 1 happened and
                // Visit 2 has not — everyone else (not started, or complete)
                // gets the dash below.
                const hasDueDate = !!r.visit1Date && !r.visit2Date;
                return (
                  <tr key={r.id} {...activatable(() => navigate(`/dental-chart/${r.id}?tab=treatments`))} className={`hover:bg-gray-50 transition-colors cursor-pointer ${r.status==='overdue'?'bg-red-50':''}`}>
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
                    <td className="px-4 py-3">{r.visit2Date ? <span className="text-green-700 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>{formatDate(r.visit2Date)}{r.earlyVisit2 && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold" title="Visit 2 recorded less than 4 months after Visit 1">early</span>}</span> : <span className="text-muted-foreground text-xs flex flex-col items-start gap-1">Not done
                      {r.syCutoff === 'impossible' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold" title={`Even the earliest allowed Visit 2 (+4 months) falls after this school year ends (${r.syDeadline}) — it can't be counted for DOH/PhilHealth this school year`}>won't fit SY</span>}
                      {r.syCutoff === 'tight' && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold" title={`The 4–6 month window extends past the school year — Visit 2 must be done by ${r.syDeadline} to count for DOH/PhilHealth`}>by {r.syDeadline}</span>}
                    </span>}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.color}`}>{sc.label}</span></td>
                    <td className="px-4 py-3">
                      {hasDueDate ? (
                        r.status === 'overdue' ? (
                          <span className="text-red-600 text-xs flex items-center gap-1 font-semibold"><Clock className="w-3 h-3"/>{Math.abs(r.daysUntilDue)}d overdue</span>
                        ) : (
                          <span className="text-warning text-xs flex items-center gap-1"><Clock className="w-3 h-3"/>{r.daysUntilDue}d</span>
                        )
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-sm text-muted-foreground">
          <Pagination
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            from={total === 0 ? 0 : (page - 1) * pageSize + 1}
            to={Math.min(page * pageSize, total)}
            total={total}
            onPage={setPage}
            onPageSize={changePageSize}
            noun="records"
            detail={total !== schoolTotal ? `(filtered from ${schoolTotal})` : ''}
          />
        </div>
      </div>
    </div>
  );
};
