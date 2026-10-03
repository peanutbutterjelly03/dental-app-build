import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { GradeTableCell } from './GradeTableCell';
import { ListSearchInput } from './ListSearchInput';
import { studentListTableStyles } from './StudentListTableStyles';
import { useStudents } from '../hooks/useStudents';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { activatable } from '../utils/a11y';

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

export const DentalChartList = () => {
  const navigate = useNavigate();
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const { students: mockPatients, loading: studentsLoading } = useStudents();

  const allSections = useMemo(() => {
    let base = gradeFilter !== 'all' ? mockPatients.filter(p => p.grade === gradeFilter) : mockPatients;
    return [...new Set(base.map(p => p.section))].sort();
  }, [gradeFilter, mockPatients]);

  const filtered = useMemo(() => mockPatients.filter(p => {
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
  }), [mockPatients, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, searchTerm]);

  const hasActiveFilters = gradeFilter !== 'all' || sectionFilter !== 'all' || genderFilter !== 'all' || ageGroupFilter !== 'all' || searchTerm !== '';
  const clearFilters = () => { setGradeFilter('all'); setSectionFilter('all'); setGenderFilter('all'); setAgeGroupFilter('all'); setSearchTerm(''); };

  const FilterSelect = ({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: { value: string; label: string }[] }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="all">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dental Charts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} record{filtered.length !== 1 ? 's' : ''} found</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <ListSearchInput value={searchTerm} onChange={setSearchTerm} />
          <FilterSelect value={gradeFilter} onChange={v => { setGradeFilter(v); setSectionFilter('all'); }} label="All Grades"
            options={GRADES.map(g => ({ value: g, label: g }))} />
          <FilterSelect value={sectionFilter} onChange={setSectionFilter} label="All Sections"
            options={allSections.map(s => ({ value: s, label: s }))} />
          <FilterSelect value={genderFilter} onChange={setGenderFilter} label="All Genders"
            options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
          <FilterSelect value={ageGroupFilter} onChange={setAgeGroupFilter} label="All Age Groups"
            options={[{ value: '4 & below', label: '4 & below' }, { value: '5-9', label: '5-9' }, { value: '10-14', label: '10-14' }, { value: '15-19', label: '15-19' }, { value: '20 & above', label: '20 & above' }]} />
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
              <X className="w-3 h-3" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Table */}
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
                <tr><td colSpan={5} className={studentListTableStyles.emptyCell}>{hasActiveFilters ? <>No students match your filters. <button onClick={clearFilters} className="text-[#1E40AF] hover:underline font-medium">Clear filters</button></> : 'No students at this school yet.'}</td></tr>
              ) : filtered.map(patient => {
                const age = calculateAge(patient.birthdate);
                return (
                  <tr key={patient.id} {...activatable(() => navigate(`/dental-chart/${patient.id}`))} className={studentListTableStyles.row}>
                    <td className={studentListTableStyles.primaryCell}>{patient.name}</td>
                    <GradeTableCell grade={patient.grade} />
                    <td className={studentListTableStyles.secondaryCell}>{patient.section}</td>
                    <td className={studentListTableStyles.secondaryCell}>{patient.gender}</td>
                    <td className={studentListTableStyles.secondaryCell}>{age}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className={studentListTableStyles.footer}>
            Showing {filtered.length} of {mockPatients.length} records
          </div>
        )}
      </div>
    </div>
  );
};
