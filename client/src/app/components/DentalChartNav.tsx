import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { GradeTableCell } from './GradeTableCell';
import { ListSearchInput } from './ListSearchInput';
import { studentListTableStyles } from './StudentListTableStyles';
import { getQueuedStudentIds } from '../utils/queueStorage';
import { useStudents } from '../hooks/useStudents';
import { useAuth } from '../context/AuthContext';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';
import { Pagination, usePagination } from './Pagination';

const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];

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

export const DentalChartNav = () => {
  const navigate = useNavigate();
  // Open on Full List when nothing is queued — an empty default view reads as a dead page
  const [viewMode, setViewMode] = useState<'queued' | 'full'>(() => (getQueuedStudentIds().length ? 'queued' : 'full'));
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const queuedStudentIds = useMemo(() => getQueuedStudentIds(), []);
  const { selectedSchool } = useAuth();
  const { students: allStudents, loading: studentsLoading } = useStudents();
  // School-scoped like every other list page
  const mockPatients = useMemo(
    () => (selectedSchool ? allStudents.filter((s) => s.school === selectedSchool) : allStudents),
    [allStudents, selectedSchool],
  );

  const sourcePatients = useMemo(
    () => (viewMode === 'queued' ? mockPatients.filter((p) => queuedStudentIds.includes(p.id)) : mockPatients),
    [viewMode, queuedStudentIds, mockPatients],
  );

  const allSections = useMemo(() => {
    const base = gradeFilter !== 'all' ? sourcePatients.filter((p) => p.grade === gradeFilter) : sourcePatients;
    return [...new Set(base.map(p => p.section))].sort();
  }, [gradeFilter, sourcePatients]);

  const filtered = useMemo(() => sourcePatients.filter(p => {
    const age = calculateAge(p.birthdate);
    const ag = getAgeGroup(age);
    if (gradeFilter !== 'all' && p.grade !== gradeFilter) return false;
    if (sectionFilter !== 'all' && p.section !== sectionFilter) return false;
    if (genderFilter !== 'all' && p.gender !== genderFilter) return false;
    if (ageGroupFilter !== 'all' && ag !== ageGroupFilter) return false;
    if (searchTerm) {
      const query = searchTerm.toLowerCase();
      const formattedName = p.name.toLowerCase();
      if (!formattedName.includes(query) && !p.grade.toLowerCase().includes(query) && !p.section.toLowerCase().includes(query)) return false;
    }
    return true;
  }), [sourcePatients, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, searchTerm]);

  // Paged (Sprint 58). This is the real Dental Charts list page — it rendered
  // every filtered row, which is thousands at ~8,000 students. Reset keys are
  // the filter inputs, never `filtered` — see Pagination.tsx.
  const pager = usePagination(filtered, [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, searchTerm, viewMode]);

  const hasActiveFilters = gradeFilter !== 'all' || sectionFilter !== 'all' || genderFilter !== 'all' || ageGroupFilter !== 'all' || searchTerm !== '';
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setGenderFilter('all'); setAgeGroupFilter('all'); setSearchTerm(''); };

  const FS = ({ value, onChange, opts, label }: { value: string; onChange: (v: string) => void; opts: {v:string;l:string}[]; label: string }) => (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="all">{label}</option>
      {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );

  if (studentsLoading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dental Charts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {viewMode === 'queued' ? `${filtered.length} queued student${filtered.length !== 1 ? 's' : ''}` : `${filtered.length} chart${filtered.length !== 1 ? 's' : ''} found`}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('queued')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'queued' ? 'bg-white text-[#1E40AF] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Queued
          </button>
          <button
            onClick={() => setViewMode('full')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${viewMode === 'full' ? 'bg-white text-[#1E40AF] shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Full List
          </button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <ListSearchInput value={searchTerm} onChange={setSearchTerm} />
          <FS value={gradeFilter} onChange={g => { setGradeFilter(g); setSectionFilter('all'); }} label="All Grades" opts={GRADES.map(g => ({ v: g, l: g }))} />
          <FS value={sectionFilter} onChange={setSectionFilter} label="All Sections" opts={allSections.map(s => ({ v: s, l: s }))} />
          <FS value={genderFilter} onChange={setGenderFilter} label="All Genders" opts={[{ v:'Male', l:'Male' }, { v:'Female', l:'Female' }]} />
          <FS value={ageGroupFilter} onChange={setAgeGroupFilter} label="All Age Groups"
            opts={[{ v:'4 & below', l:'4 & below' }, { v:'5-9', l:'5-9' }, { v:'10-14', l:'10-14' }, { v:'15-19', l:'15-19' }, { v:'20 & above', l:'20 & above' }]} />
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
              <X className="w-3 h-3" /> Clear All
            </button>
          )}
        </div>
      </div>
      <div className={studentListTableStyles.wrapper}>
        <div className={studentListTableStyles.scroller}>
          <table className={studentListTableStyles.table}>
            <thead className={studentListTableStyles.head}>
              <tr>
                <th className={studentListTableStyles.headerCell}>Student</th>
                <th className={studentListTableStyles.headerCell}>Grade</th>
                <th className={studentListTableStyles.headerCell}>Section</th>
                <th className={studentListTableStyles.headerCell}>Gender</th>
                <th className={studentListTableStyles.headerCell}>Age</th>
              </tr>
            </thead>
            <tbody className={studentListTableStyles.body}>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className={studentListTableStyles.emptyCell}>{viewMode === 'queued' && queuedStudentIds.length === 0 ? 'No students queued for charting yet — use "Queue for Charting" on the Students page, or switch to Full List.' : 'No dental charts match the selected filters.'}</td></tr>
              ) : pager.paged.map(p => {
                const age = calculateAge(p.birthdate);
                return (
                  <tr key={p.id} {...activatable(() => navigate(`/dental-chart/${p.id}?tab=history&context=dental-queue`))} className={studentListTableStyles.row}>
                    <td className={studentListTableStyles.primaryCell}>{p.name}</td>
                    <GradeTableCell grade={p.grade} />
                    <td className={studentListTableStyles.secondaryCell}>{p.section}</td>
                    <td className={studentListTableStyles.secondaryCell}>{p.gender}</td>
                    <td className={studentListTableStyles.secondaryCell}>{age}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className={studentListTableStyles.footer}>
            <Pagination
              {...pager}
              onPage={pager.setPage}
              onPageSize={pager.changePageSize}
              noun={viewMode === 'queued' ? 'queued students' : 'charts'}
              detail={filtered.length !== sourcePatients.length ? `(filtered from ${sourcePatients.length})` : ''}
            />
          </div>
        )}
      </div>
    </div>
  );
};
