import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Search, Plus, X, CheckCircle, AlertCircle, Clock, Shield, School as SchoolIcon, List, ChevronRight, Users } from 'lucide-react';
import { getGradeColor } from '../utils/gradeColors';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { treatmentCodes, treatmentLabel } from './DentalChart';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { Pagination, usePagination } from './Pagination';
import { apiClient } from '../api/client';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { schoolYearLabel } from '../utils/schoolYear';
import type { RPCRow } from '../hooks/useRPCTracking';

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
  const toast = useToast();
  const { records: rpcRecords, loading, error, reload } = useRPCTracking();

  // Recording a visit (Sprint 81). Until now PREVENTIVE_CARE_RECORD had NO
  // write path anywhere in the app — the two-visit RPC module could be read
  // and filtered, but a visit could only be created by a seed script.
  const [recording, setRecording] = useState<RPCRow | null>(null);
  const [visitDate, setVisitDate] = useState('');
  // null = not answered. The field is optional on purpose: an encoder who does
  // not know stores null, which reads as "not recorded" on FHSIS, rather than
  // being pushed into a default that would invent the facility split.
  const [facilityBased, setFacilityBased] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Same roles the server enforces on /preventive-care-records
  // (CLINICAL_WRITE_ROLES in routes/index.ts). Checked here too so the button
  // is absent rather than present-and-403 for a school admin or BHO viewer.
  const canRecord = user?.role === 'dentist' || user?.role === 'dental_aide' || user?.role === 'system_admin';

  const openRecord = (r: RPCRow) => {
    setRecording(r);
    // Defaults to today but stays editable — a visit is often encoded a day or
    // two after it happened. Local date parts, never toISOString: that shifts
    // the date backwards for UTC+8 (the Sprint 20 vanishing-appointments bug).
    const now = new Date();
    setVisitDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    setFacilityBased(null);
    setSaveError(null);
  };

  // The IPTR the visit will attach to, resolved from the school year of THE
  // VISIT DATE — a visit backdated to March belongs to the school year running
  // in March, not to today's. Recomputes as the date changes, so the modal can
  // say up front which record it is about to write to.
  const targetIptrId = recording && visitDate
    ? recording.iptrIdBySchoolYear[schoolYearLabel(new Date(`${visitDate}T00:00:00`))] ?? null
    : null;
  const targetSchoolYear = visitDate ? schoolYearLabel(new Date(`${visitDate}T00:00:00`)) : '';

  const saveVisit = async () => {
    if (!recording || !targetIptrId || !recording.nextVisitNumber) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.post('/preventive-care-records', {
        iptr_id: targetIptrId,
        visit_date: visitDate,
        visit_number: recording.nextVisitNumber,
        facility_based: facilityBased,
      });
      toast.success(`Visit ${recording.nextVisitNumber} recorded for ${recording.studentName}.`);
      setRecording(null);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to record the visit');
    } finally {
      setSaving(false);
    }
  };

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

  const calculateAge = (birthdate: string) => {
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };

  const getAgeGroup = (age: number) => {
    if (age <= 4) return '4 & below';
    if (age <= 9) return '5-9';
    if (age <= 14) return '10-14';
    if (age <= 19) return '15-19';
    return '20 & above';
  };

  const schoolRecords = selectedSchool
    ? rpcRecords.filter(r => r.school === selectedSchool)
    : rpcRecords;

  const filtered = useMemo(() => schoolRecords.filter(r => {
    const age = calculateAge(r.birthdate);
    if (gradeFilter !== 'all' && r.grade !== gradeFilter) return false;
    if (sectionFilter !== 'all' && r.section !== sectionFilter) return false;
    if (genderFilter !== 'all' && r.gender !== genderFilter) return false;
    if (ageGroupFilter !== 'all' && getAgeGroup(age) !== ageGroupFilter) return false;
    if (statusFilter === 'outstanding') { if (r.status === 'complete') return false; }
    else if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (treatmentFilter !== 'all' && !r.treatmentCodes.includes(treatmentFilter)) return false;
    if (searchTerm && !r.studentName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  }), [schoolRecords, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, statusFilter, treatmentFilter, searchTerm]);

  // Paged (Sprint 58): this list rendered EVERY filtered row, which is fine at
  // demo scale and thousands of DOM rows at ~8,000 students. Reset keys are the
  // filter inputs, never `filtered` — see Pagination.tsx.
  const pager = usePagination(filtered, [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, statusFilter, treatmentFilter, searchTerm]);

  // sectionFilter was missing from both of these — an active section filter
  // neither lit up "Clear All" nor got cleared by it.
  // statusFilter is compared against 'outstanding', not 'all': that is now its
  // resting value, so treating it like the others would light up "Clear All"
  // permanently and make Clear All widen the list instead of resetting it.
  const hasActiveFilters = [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, treatmentFilter].some(f => f !== 'all') || statusFilter !== 'outstanding' || searchTerm !== '';
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setGenderFilter('all'); setAgeGroupFilter('all'); setStatusFilter('outstanding'); setTreatmentFilter('all'); setSearchTerm(''); };

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
          <FS value={sectionFilter} onChange={setSectionFilter} label="All Sections" opts={[...new Set((gradeFilter !== 'all' ? schoolRecords.filter(r => r.grade === gradeFilter) : schoolRecords).map(r => r.section))].sort().map(s => ({v:s,l:s}))} />
          <FS value={genderFilter} onChange={setGenderFilter} label="All Genders" opts={[{v:'Male',l:'Male'},{v:'Female',l:'Female'}]} />
          <FS value={ageGroupFilter} onChange={setAgeGroupFilter} label="All Age Groups" opts={[{v:'4 & below',l:'4 & below'},{v:'5-9',l:'5-9'},{v:'10-14',l:'10-14'},{v:'15-19',l:'15-19'},{v:'20 & above',l:'20 & above'}]} />
          {/* 'outstanding' is listed first and is the default — FS renders its
              `label` as the value-'all' option, so without an explicit entry
              here the select would have no option matching its own value. */}
          <FS value={statusFilter} onChange={setStatusFilter} label="All Statuses (incl. complete)" opts={[{v:'outstanding',l:'Outstanding only'},{v:'complete',l:'Both Complete'},{v:'pending',l:'Visit 1 Only'},{v:'overdue',l:'Overdue'},{v:'not-started',l:'Not Started'}]} />
          <FS value={treatmentFilter} onChange={setTreatmentFilter} label="All Treatments" opts={treatmentCodes.map(t=>({v:t.code,l:treatmentLabel(t)}))} />
          {hasActiveFilters && <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-destructive border border-red-200 rounded-lg hover:bg-red-50"><X className="w-3 h-3"/>Clear All</button>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                {['Student','School','Grade / Section','Visit 1','Visit 2','Status','Days Until Due'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-foreground">{h}</th>
                ))}
                {canRecord && <th className="text-right px-4 py-3 font-semibold text-foreground">Record</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={canRecord ? 8 : 7} className="text-center py-12 text-muted-foreground">{hasActiveFilters ? <>No records match your filters. <button onClick={clearFilters} className="text-primary hover:underline font-medium">Clear filters</button></> : 'No RPC records for this school yet.'}</td></tr>
              ) : pager.paged.map(r => {
                const sc = statusConfig[r.status] || statusConfig['not-started'];
                const gc = getGradeColor(r.grade);
                return (
                  <tr key={r.id} {...activatable(() => navigate(`/dental-chart/${r.id}?tab=treatments`))} className={`hover:bg-gray-50 transition-colors cursor-pointer ${r.status==='overdue'?'bg-red-50':''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">{r.studentName.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
                        <span className="font-medium text-foreground">{r.studentName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs max-w-[130px] truncate">{r.school}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold" style={{backgroundColor:gc.light,color:gc.solid}}>{r.grade}</span>
                      <span className="text-muted-foreground text-xs ml-1">{r.section}</span>
                    </td>
                    <td className="px-4 py-3">{r.visit1Date ? <span className="text-green-700 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>{r.visit1Date}</span> : <span className="text-muted-foreground text-xs">Not done</span>}</td>
                    <td className="px-4 py-3">{r.visit2Date ? <span className="text-green-700 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3"/>{r.visit2Date}{r.earlyVisit2 && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold" title="Visit 2 recorded less than 4 months after Visit 1">early</span>}</span> : <span className="text-muted-foreground text-xs flex items-center gap-1.5 flex-wrap">Not done
                      {r.syCutoff === 'impossible' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold" title={`Even the earliest allowed Visit 2 (+4 months) falls after this school year ends (${r.syDeadline}) — it can't be counted for DOH/PhilHealth this school year`}>won't fit SY</span>}
                      {r.syCutoff === 'tight' && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold" title={`The 4–6 month window extends past the school year — Visit 2 must be done by ${r.syDeadline} to count for DOH/PhilHealth`}>by {r.syDeadline}</span>}
                    </span>}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${sc.bg} ${sc.color}`}>{sc.label}</span></td>
                    <td className="px-4 py-3 text-sm">{r.status==='overdue'?<span className="text-red-600 font-semibold">{Math.abs(r.daysUntilDue)}d overdue</span>:r.daysUntilDue>0?<span className="text-blue-600">{r.daysUntilDue}d</span>:<span className="text-muted-foreground">—</span>}</td>
                    {canRecord && (
                      // stopPropagation: the whole row navigates to the dental
                      // chart, so without it recording a visit would also leave
                      // the page the moment the modal opened.
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {r.nextVisitNumber === null ? (
                          <span className="text-xs text-muted-foreground">Both done</span>
                        ) : Object.keys(r.iptrIdBySchoolYear).length === 0 ? (
                          // No IPTR at all, so there is nothing to attach a
                          // visit to. Saying so beats a button that 400s, and it
                          // names the fix. (Which school YEAR is missing is
                          // decided in the modal, once a date is chosen.)
                          <span className="text-xs text-muted-foreground" title="This student has no IPTR yet — open their record and create one first.">No IPTR</span>
                        ) : (
                          <button
                            onClick={() => openRecord(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-gray-50 whitespace-nowrap"
                          >
                            <Plus className="w-3 h-3" />Visit {r.nextVisitNumber}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-sm text-muted-foreground">
          <Pagination
            {...pager}
            onPage={pager.setPage}
            onPageSize={pager.changePageSize}
            noun="records"
            detail={filtered.length !== schoolRecords.length ? `(filtered from ${schoolRecords.length})` : ''}
          />
        </div>
      </div>

      {recording && (
        <Modal onClose={() => setRecording(null)} maxWidth="max-w-md" closeDisabled={saving}>
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-lg font-bold text-foreground">Record Visit {recording.nextVisitNumber}</h2>
            <button onClick={() => setRecording(null)} disabled={saving} className="text-muted-foreground hover:text-foreground disabled:opacity-50"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">{recording.studentName}</p>
              <p className="text-xs text-muted-foreground">{recording.grade} {recording.section} · {recording.school}</p>
            </div>

            {recording.nextVisitNumber === 2 && recording.visit1Date && (
              <p className="text-xs text-muted-foreground bg-gray-50 border border-border rounded-lg px-3 py-2">
                Visit 1 was {recording.visit1Date}. The DOH window is 4–6 months after it
                {recording.syCutoff === 'tight' && recording.syDeadline && <> and this school year ends {recording.syDeadline}</>}.
              </p>
            )}

            <div>
              <label htmlFor="rpc-visit-date" className="block text-sm font-medium text-foreground mb-1">Visit date</label>
              <input
                id="rpc-visit-date"
                type="date"
                value={visitDate}
                onChange={e => setVisitDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Which record this lands on, stated before saving rather than
                discovered afterwards. The year follows the DATE above, so
                changing the date can change the answer. */}
            {targetIptrId ? (
              <p className="text-xs text-muted-foreground">
                Will be filed under the <span className="font-medium text-foreground">{targetSchoolYear}</span> IPTR.
              </p>
            ) : (
              <p className="text-xs text-destructive bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                This student has no IPTR for <span className="font-medium">{targetSchoolYear}</span>, the school year
                that date falls in. Pick a date inside a school year they have a record for, or create the
                {' '}{targetSchoolYear} IPTR first — a visit is not filed against another year&rsquo;s record.
              </p>
            )}

            <fieldset>
              <legend className="block text-sm font-medium text-foreground mb-1">Facility-based care?</legend>
              {/* Three states, not a checkbox. FHSIS Section D splits each band
                  into facility-based (a) and non-facility-based (b) sub-rows,
                  and "not recorded" is a real third answer — a checkbox would
                  force every visit into one of two, inventing the split. */}
              <div className="flex flex-wrap gap-2">
                {([[true, 'Facility-based'], [false, 'Non-facility-based'], [null, 'Not recorded']] as const).map(([val, label]) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setFacilityBased(val)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${facilityBased === val ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-gray-50'}`}
                  >{label}</button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave as “Not recorded” if unsure — the FHSIS report shows those separately rather than counting them in either row.
              </p>
            </fieldset>

            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t">
            <button onClick={() => setRecording(null)} disabled={saving} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button onClick={saveVisit} disabled={saving || !visitDate || !targetIptrId} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Record visit'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
