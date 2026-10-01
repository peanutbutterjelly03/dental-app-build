import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Plus, Eye, FileText, X, School as SchoolIcon, List, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Users, Upload, CheckCircle, AlertCircle, ScanLine, GraduationCap, MoreVertical, ListChecks, Archive as ArchiveIcon, Copy, ListPlus } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { formatDate } from '../utils/localDate';
import { OCR_CONFIDENCE_THRESHOLD, type IptrOcrFieldKey, type IptrCheckboxFinding } from '../utils/iptrOcrShared';
import { getGradeColor } from '../utils/gradeColors';
import { getSchoolColor, getSchoolShortName } from '../utils/schoolColors';
import { GradePill } from './GradePill';
import { PipelineStatusPill } from './PipelineStatusPill';
import { StudentRiskChip } from './risk/StudentRiskChip';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { activatable } from '../utils/a11y';
import { parseSpreadsheetRecords, normalizeSex, normalizeGrade } from '../utils/studentImport';
import { ListSearchInput } from './ListSearchInput';
import { addQueuedStudentId, getQueuedStudentIds, removeQueuedStudentId, setQueuedStudentIds as persistQueuedStudentIds } from '../utils/queueStorage';
import { useStudents } from '../hooks/useStudents';
import { useRPCTracking } from '../hooks/useRPCTracking';
import { usePagination, PAGE_SIZE_OPTIONS } from './Pagination';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool } from '../api/types';
import { schoolYearLabel } from '../utils/schoolYear';
import { calculateAge, getAgeGroup } from '../utils/age';
import { Notice } from './Notice';
import { TOPBAR_H } from '../utils/layout';
// Re-applied on top of her file (Sprint 158). Sprints 120/121 added value
// checks here and the SAME shared rules to the server and the bulk importer,
// so the three cannot disagree about what a valid birthday is. Taking her
// layout must not quietly drop the client half of that.
import { validateStudentValues } from '../../../shared/studentValidation';

const GRADES = ['Kinder','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];

// Sentinels for "not assigned yet" (user, 2026-09-28) -- a new school year's
// promotion leaves a pupil's grade/section blank until re-assigned, and
// that population needs to be findable, not just invisible among "All
// Grades"/"All Sections". Distinct from '' itself so a literal empty string
// value on a <select> (which reads as unset) can never collide with these.
const NO_GRADE = '__no_grade__';
const NO_SECTION = '__no_section__';

/** Male before Female in the default sort; anything else (data the intake
 *  form doesn't otherwise produce) sorts after both rather than being lost
 *  at the front or crashing the comparator. */
const GENDER_SORT_ORDER: Record<string, number> = { Male: 0, Female: 1 };

/** The add-form's default input styling — the baseline `ocrFieldClass` falls
 *  back to, and what fields that can never be scanned use outright. */
const plainFieldClass = 'w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// Shape of the candidates the server returns with a 409 from POST /students
// (see server/utils/studentDuplicates.ts) — enough to recognise the child, not
// the whole record.
export type DuplicateCandidate = {
  _id: string;
  full_name: string;
  grade_level: string;
  section: string;
  sex: string;
  birthday: string;
};

/** Pulls the candidate list off a 409, or null if this isn't a duplicate
 *  rejection. Keeps the type assertion in one place. */
export const duplicatesFromError = (err: unknown): DuplicateCandidate[] | null => {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const list = err.body?.duplicates;
  return Array.isArray(list) && list.length > 0 ? (list as DuplicateCandidate[]) : null;
};

// ── Bulk import parsing (Sprint 23m) ─────────────────────────────────────────
// The prototype's "Parse File" ignored the upload and fabricated 5 students,
// and "Import" saved nothing. This is the real thing: CSV/XLSX → validated
// rows → POST /students per row. birthday + address are REQUIRED by the
// Student model (not optional as the old helper text claimed).
type BulkRow = {
  lastName: string; firstName: string; middleName: string; sex: string;
  grade: string; section: string; birthday: string; address: string;
  contactNumber: string; error: string | null;
};

const buildBulkRow = (rec: Record<string, string>): BulkRow => {
  const get = (...keys: string[]) => { for (const k of keys) if (rec[k]) return rec[k]; return ''; };
  const lastName = get('last_name', 'lastname', 'surname');
  const firstName = get('first_name', 'firstname', 'given_name');
  const middleName = get('middle_name', 'middlename');
  const sexRaw = get('sex', 'gender');
  const gradeRaw = get('grade_level', 'grade', 'gradelevel');
  const section = get('section');
  const birthday = get('birthday', 'birthdate', 'birth_date', 'date_of_birth');
  const address = get('address');
  const contactNumber = get('contact_number', 'contact', 'contactnumber', 'phone');
  const sex = normalizeSex(sexRaw);
  const grade = gradeRaw ? normalizeGrade(gradeRaw) : null;
  let error: string | null = null;
  if (!lastName || !firstName) error = 'Missing name';
  else if (!sex) error = sexRaw ? `Unrecognized sex "${sexRaw}"` : 'Missing sex';
  else if (!grade) error = gradeRaw ? `Unrecognized grade "${gradeRaw}"` : 'Missing grade level';
  else if (!section) error = 'Missing section';
  else if (!birthday) error = 'Missing birthday';
  else if (isNaN(new Date(birthday).getTime())) error = `Invalid birthday "${birthday}"`;
  else if (!address) error = 'Missing address';
  return { lastName, firstName, middleName, sex: sex ?? sexRaw, grade: grade ?? gradeRaw, section, birthday, address, contactNumber, error };
};


export type NewPatientForm = {
  firstName: string; lastName: string; middleName: string; birthdate: string; gender: string;
  grade: string; section: string; school: string; placeOfBirth: string; guardianName: string; guardianContact: string;
  guardianOccupation: string; address: string; contactNumber: string; philhealthNumber: string; philhealthStatus: string;
  is4Ps: boolean; fourPsId: string; consentStatus: string;
  /** A person entered through this form who isn't actually enrolled (e.g. a
   *  sibling or community member treated at a Bayanihan mission) -- Grade,
   *  Section and Sex don't apply, so checking this clears and disables them
   *  instead of requiring values that don't exist. */
  isNotStudent: boolean;
};

/** One source for "what a blank Add Student form looks like" — used on
 *  mount, after a successful save, and when the form is closed via the
 *  header X (closing no longer leaves stale values for next time). */
export const BLANK_NEW_PATIENT: NewPatientForm = {
  firstName:'', lastName:'', middleName:'', birthdate:'', gender:'', grade:'', section:'', school:'',
  placeOfBirth:'', guardianName:'', guardianContact:'', guardianOccupation:'', address:'', contactNumber:'', philhealthNumber:'',
  philhealthStatus:'None', is4Ps:false, fourPsId:'', consentStatus:'pending', isNotStudent:false,
};

/** Fields the Add Student form requires, and the label each one shows.
 *
 *  Everything here is enforced ONLY at this layer: none of these fields are
 *  schema-required, so a schema-level requirement would make every
 *  pre-existing student unsaveable on the next edit.
 *
 *  NOT required, on purpose:
 *  · middleName — some children genuinely have none, and full_name is DERIVED
 *    from the name parts, so forcing "N/A" would propagate that placeholder
 *    into every list, heading, report and DOH form.
 *  · address — not schema-required either (2026-09-04, user decision;
 *    DATA-MODEL.md never listed it as required, unlike last/first name).
 *  · contactNumber — not schema-required either (2026-09-04, user decision).
 *  · philhealthNumber — the user's explicit exception.
 *  · philhealthStatus — always has a value ("None"). */
export const REQUIRED_STUDENT_FIELDS: {
  key: keyof NewPatientForm;
  label: string;
  onlyIf?: (f: NewPatientForm) => boolean;
}[] = [
  { key: 'lastName', label: 'Last Name' },
  { key: 'firstName', label: 'First Name' },
  { key: 'birthdate', label: 'Birthdate' },
  { key: 'gender', label: 'Gender' },
  { key: 'grade', label: 'Grade', onlyIf: (f) => !f.isNotStudent },
  { key: 'section', label: 'Section', onlyIf: (f) => !f.isNotStudent },
  // Guardian Name/Contact are NOT required (2026-09-04, user decision) —
  // marked "(Optional)" on their labels instead of an asterisk.
  // Only meaningful for a 4Ps household — required unconditionally it would
  // block every non-4Ps student, and 0 of the 26 on file are 4Ps.
  { key: 'fourPsId', label: '4Ps ID', onlyIf: (f) => f.is4Ps },
];

/** Gray "(Optional)" for the two fields that used to carry a (wrong) asterisk. */
const optionalTag = <span className="text-muted-foreground font-normal"> (Optional)</span>;

export const PatientList = () => {
  const navigate = useNavigate();
  const { user, selectedSchool } = useAuth();
  const toast = useToast();
  // Matches the server's CLINICAL_WRITE_ROLES for /students (O1, 2026-10-01:
  // the System Admin could save students on the API but the screen hid Add
  // Student and OCR from them).
  const canAddStudent = user?.role === 'dentist' || user?.role === 'dental_aide' || user?.role === 'system_admin';



  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  // List view filters
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPatient, setNewPatient] = useState<NewPatientForm>(BLANK_NEW_PATIENT);
  const [addPatientError, setAddPatientError] = useState<string | null>(null);
  const [addingPatient, setAddingPatient] = useState(false);
  // Which required fields are currently empty, for the per-field "this field
  // is required" line — recomputed on every submit attempt, cleared per-field
  // as soon as that one is filled in.
  const [missingFields, setMissingFields] = useState<Set<keyof NewPatientForm>>(new Set());
  // A step between "form looks valid" and actually saving — added because a
  // typo'd Add Student click used to save immediately with no way back.
  const [showAddConfirm, setShowAddConfirm] = useState(false);
  // The id of the live-duplicate match the encoder has already acknowledged
  // (via its own X, or "Confirm different student" below) — keyed by id so
  // the badge reappears on its own if the fields change to match a
  // DIFFERENT existing student, but stays quiet for the one already handled.
  const [acknowledgedDuplicateId, setAcknowledgedDuplicateId] = useState<string | null>(null);
  const [showConfirmDifferentStudent, setShowConfirmDifferentStudent] = useState(false);
  // Whether Section's suggestion list is showing — a combobox (type to
  // filter, click to pick, or just keep typing to add a new one), not a
  // plain <select>, since section names come from the roster rather than a
  // fixed list.
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  // Non-null while the server has answered "this child may already be on file"
  // and the person encoding has to decide (Sprint 47).
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCandidate[] | null>(null);
  const [schools, setSchools] = useState<ApiSchool[]>([]);
  // Add Student's dropdown (user, 2026-09-29: merges the separate OCR button
  // into "Add Student" as a second choice) — same fixed-position-from-rect
  // pattern as the three-dot list menu below, so the card's overflow-clip
  // can't cut it off.
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addMenuAt, setAddMenuAt] = useState<{ top: number; right: number } | null>(null);
  const toggleAddMenu = () => {
    const r = addMenuBtnRef.current?.getBoundingClientRect();
    if (r) setAddMenuAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setShowAddMenu((v) => !v);
  };
  const [ocrConfidences, setOcrConfidences] = useState<Partial<Record<IptrOcrFieldKey, number>>>({});
  const [ocrFindings, setOcrFindings] = useState<IptrCheckboxFinding[]>([]);
  const [ocrFindingsNote, setOcrFindingsNote] = useState<string | null>(null);
  // Which OCR entry point pre-filled the form -- drives the review banner's
  // wording ("scanned form" vs "uploaded file") since a spreadsheet read has
  // no scan confidence to caveat the way an image/PDF read does.
  const [ocrSourceLabel, setOcrSourceLabel] = useState<'scanned form' | 'uploaded file' | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<BulkRow[]>([]);
  const [bulkStep, setBulkStep] = useState<'upload'|'preview'|'done'>('upload');
  const [bulkParseError, setBulkParseError] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkResult, setBulkResult] = useState<{ imported: number; failures: { name: string; error: string }[] }>({ imported: 0, failures: [] });

  const resetBulkUpload = () => {
    setShowBulkUpload(false);
    setBulkStep('upload');
    setBulkPreview([]);
    setBulkFile(null);
    setBulkParseError(null);
    setBulkProgress(0);
    setBulkResult({ imported: 0, failures: [] });
  };

  const handleParseBulk = async () => {
    if (!bulkFile) return;
    setBulkParseError(null);
    try {
      const records = await parseSpreadsheetRecords(bulkFile);
      setBulkPreview(records.map(buildBulkRow));
      setBulkStep('preview');
    } catch (err) {
      setBulkParseError(err instanceof Error ? err.message : 'Could not read the file. Save it as .csv or .xlsx and try again.');
    }
  };

  const handleBulkImport = async () => {
    const school = schools.find((s) => s.school_name === (selectedSchool ?? ''));
    if (!school) {
      setBulkParseError('No school workspace selected — bulk import adds students to your current school.');
      return;
    }
    const valid = bulkPreview.filter((r) => !r.error);
    if (valid.length === 0) return;
    setBulkImporting(true);
    setBulkProgress(0);
    const failures: { name: string; error: string }[] = [];
    let imported = 0;
    // sequential on purpose: keeps server load gentle and progress readable
    for (const r of valid) {
      try {
        await apiClient.post('/students', {
          school_id: school._id,
          // The parts are the stored truth; full_name is derived server-side.
          last_name: r.lastName,
          first_name: r.firstName,
          middle_name: r.middleName,
          birthday: r.birthday,
          sex: r.sex,
          address: r.address,
          contact_number: r.contactNumber,
          grade_level: r.grade,
          section: r.section,
        });
        imported++;
      } catch (err) {
        // Duplicates are reported in the summary, never as a per-row dialog —
        // a modal every few rows through an 800-row import is unusable. The
        // row is skipped, not saved: importing in bulk is not the moment to
        // decide "same child or not", and the encoder can add the genuine ones
        // individually afterwards, where the decision dialog is shown.
        const duplicates = duplicatesFromError(err);
        failures.push({
          name: `${r.lastName}, ${r.firstName}`,
          error: duplicates
            ? `Skipped — already on file as ${duplicates[0].full_name} (${duplicates[0].grade_level} ${duplicates[0].section}). Add individually if this is a different child.`
            : err instanceof ApiError ? err.message : 'Failed to save',
        });
      }
      setBulkProgress(imported + failures.length);
    }
    await reloadStudents();
    setBulkResult({ imported, failures });
    setBulkImporting(false);
    setBulkStep('done');
    if (imported > 0) toast.success(`${imported} student${imported !== 1 ? 's' : ''} imported.`);
    if (failures.length > 0) toast.error(`${failures.length} row${failures.length !== 1 ? 's' : ''} failed to import.`);
  };
  const [queuedStudentIds, setQueuedStudentIds] = useState<string[]>(() => getQueuedStudentIds());
  // Non-null while a per-row "remove from queue" click is waiting on
  // confirmation — adding to the queue stays a single click, only removing
  // asks first.
  const [dequeueTarget, setDequeueTarget] = useState<{ id: string; name: string } | null>(null);
  // tick-box selection for queueing (and now archiving) several students at
  // once. Hidden behind "Select" from the three-dot menu rather than always
  // on — a checkbox column nobody is using is just noise on a list this
  // dense, and it leaves the toolbar room for whatever gets added next.
  const [selectMode, setSelectMode] = useState(false);
  const [showListMenu, setShowListMenu] = useState(false);
  const listMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const [listMenuAt, setListMenuAt] = useState<{ top: number; right: number } | null>(null);
  const toggleListMenu = () => {
    const r = listMenuBtnRef.current?.getBoundingClientRect();
    if (r) setListMenuAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setShowListMenu((v) => !v);
  };
  const [tickedIds, setTickedIds] = useState<Set<string>>(new Set());
  const [confirmArchiveTicked, setConfirmArchiveTicked] = useState(false);
  const [archivingTicked, setArchivingTicked] = useState(false);
  // Re-typed password for the archive confirmation — a bulk action pulling
  // students off every active roster and report gets a step-up check beyond
  // "are you sure", not just a second click.
  const [archivePassword, setArchivePassword] = useState('');
  // A random, non-guessable field name — the literal string "password" in a
  // name/id is itself a strong signal several autofill engines key off, even
  // with autocomplete overridden.
  const archivePasswordFieldName = useRef(`confirm-${Math.random().toString(36).slice(2)}`).current;

  // Duplicate-records scan (housekeeping, not the create-time 409 check
  // above) — groups of already-saved students that look like the same child
  // encoded more than once. Fetched on demand from the three-dot menu, not
  // on every list load.
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateCandidate[][]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);

  const loadDuplicates = async () => {
    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const school = schools.find((s) => s.school_name === selectedSchool);
      const query = school ? `?school_id=${school._id}` : '';
      const groups = await apiClient.get<DuplicateCandidate[][]>(`/students/duplicates${query}`);
      setDuplicateGroups(groups);
    } catch (err) {
      setDuplicatesError(err instanceof ApiError ? err.message : 'Could not load duplicate records.');
    } finally {
      setDuplicatesLoading(false);
    }
  };

  // Archiving one duplicate reuses the exact same tickedIds + password
  // confirmation flow as the bulk toolbar action — a duplicate row is just a
  // one-student selection, not a separate archive path to maintain.
  const archiveOneDuplicate = (id: string) => {
    setTickedIds(new Set([id]));
    setArchivePassword('');
    setArchivePasswordError(null);
    setConfirmArchiveTicked(true);
  };
  const [archivePasswordError, setArchivePasswordError] = useState<string | null>(null);

  const exitSelectMode = () => {
    setSelectMode(false);
    setTickedIds(new Set());
  };

  // Bulk Queue (user, 2026-09-27): a SEPARATE mode from the plain
  // Select-Students/Archive one above -- not just another action inside it.
  // Mirrors Dental Charts' own bulk Dequeue exactly: entering it (via
  // "Queue" in the "⋮" menu) reveals checkboxes AND makes each row's
  // Grade/Section clickable as selection criteria, and a dark bar (count,
  // "All", removable criteria pills, Queue, Cancel) appears below the
  // header instead of the plain toolbar's Archive icon.
  const [bulkQueueMode, setBulkQueueMode] = useState(false);
  const [activeGradeCriteriaQ, setActiveGradeCriteriaQ] = useState<Set<string>>(new Set());
  const [activeSectionCriteriaQ, setActiveSectionCriteriaQ] = useState<Set<string>>(new Set());
  const exitBulkQueueMode = () => {
    setBulkQueueMode(false);
    setTickedIds(new Set());
    setActiveGradeCriteriaQ(new Set());
    setActiveSectionCriteriaQ(new Set());
  };
  // Criteria match against `filtered` (every student matching the current
  // search/grade/section/etc. filters), not just the current page -- same
  // reasoning as Dental Charts' `queuedInView`: selecting shouldn't reach
  // past what the filters already narrowed to, but SHOULD reach past
  // whatever page happens to be showing.
  const toggleGradeCriterionQ = (grade: string) => {
    const matching = filtered.filter(s => !s.pending && s.grade === grade).map(s => s.id);
    const turningOn = !activeGradeCriteriaQ.has(grade);
    setActiveGradeCriteriaQ(prev => {
      const next = new Set(prev);
      if (turningOn) next.add(grade); else next.delete(grade);
      return next;
    });
    setTickedIds(prev => {
      const next = new Set(prev);
      matching.forEach(id => (turningOn ? next.add(id) : next.delete(id)));
      return next;
    });
  };
  const toggleSectionCriterionQ = (section: string) => {
    const matching = filtered.filter(s => !s.pending && s.section === section).map(s => s.id);
    const turningOn = !activeSectionCriteriaQ.has(section);
    setActiveSectionCriteriaQ(prev => {
      const next = new Set(prev);
      if (turningOn) next.add(section); else next.delete(section);
      return next;
    });
    setTickedIds(prev => {
      const next = new Set(prev);
      matching.forEach(id => (turningOn ? next.add(id) : next.delete(id)));
      return next;
    });
  };
  // `selectableFiltered`/`allFilteredSelected`/`toggleSelectAllFilteredQ` are
  // defined further down, right after `filtered` itself -- a useMemo here
  // would read `filtered` before its own declaration runs (TDZ), same bug
  // class Dental Charts hit with `queuedInView`.

  const archiveTicked = async () => {
    if (!archivePassword) {
      setArchivePasswordError('Enter your password to confirm.');
      return;
    }
    setArchivingTicked(true);
    try {
      await apiClient.post('/auth/verify-password', { password: archivePassword });
    } catch (err) {
      setArchivingTicked(false);
      setArchivePasswordError(err instanceof ApiError ? err.message : 'Could not verify password.');
      return;
    }
    let archived = 0;
    let lastArchivedName = '';
    const failed: string[] = [];
    for (const id of tickedIds) {
      const student = schoolStudents.find(s => s.id === id);
      try {
        await apiClient.patch(`/students/${id}/archive`);
        archived += 1;
        lastArchivedName = student?.name ?? '';
      } catch (err) {
        failed.push(`${student?.name ?? id} — ${err instanceof ApiError ? err.message : 'failed'}`);
      }
    }
    setArchivingTicked(false);
    setConfirmArchiveTicked(false);
    setArchivePassword('');
    exitSelectMode();
    await reloadStudents();
    // Archived students no longer belong in the duplicates list — refresh it
    // so an archived-from-there row doesn't linger until the modal reopens.
    if (showDuplicates) await loadDuplicates();
    if (archived > 0) toast.success(archived === 1 && lastArchivedName ? `${lastArchivedName} is archived.` : `${archived} student${archived === 1 ? ' is' : 's are'} archived.`);
    if (failed.length > 0) toast.error(`${failed.length} could not be archived — see console.`);
  };

  const toggleTicked = (id: string) => {
    setTickedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Executes the actual Bulk Queue, from bulkQueueMode's dark bar. Not
  // destructive, so no password confirmation like Archive needs.
  const bulkQueueTicked = () => {
    const ids = Array.from(tickedIds);
    const merged = Array.from(new Set([...queuedStudentIds, ...ids]));
    persistQueuedStudentIds(merged);
    setQueuedStudentIds(merged);
    exitBulkQueueMode();
    const onlyName = ids.length === 1 ? schoolStudents.find(s => s.id === ids[0])?.name : undefined;
    toast.success(onlyName ? `${onlyName} is queued.` : `${ids.length} student${ids.length === 1 ? ' is' : 's are'} queued.`);
  };

  // calculateAge / getAgeGroup are the shared ones (BUG-02).

  const { students: allStudents, loading: studentsLoading, reload: reloadStudents } = useStudents();
  // For the Status column's RPC chip (user, 2026-09-28: "the RPC should
  // only show if they are due this month") -- same 'due_this_month' rule
  // Treatment Queue's own auto-enqueue and RPC Monitoring's sort/filter use.
  const { records: rpcDueThisMonth } = useRPCTracking({ school: selectedSchool ?? undefined, sort: 'due_this_month', limit: 1000 });
  const rpcDueThisMonthIds = useMemo(() => new Set(rpcDueThisMonth.map((r) => r.id)), [rpcDueThisMonth]);

  useEffect(() => {
    apiClient.get<ApiSchool[]>('/schools').then(setSchools).catch(() => {});
  }, []);

  // Pins the toolbar and the card's header/filter block at the top, stacked
  // below TOPBAR_H (the fixed status strip — see DentalChart.tsx for the same
  // pattern). Heights are measured rather than hardcoded because the filter
  // row wraps to more than one line at narrow widths.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const cardHeaderRef = useRef<HTMLDivElement | null>(null);
  const [stickyTop, setStickyTop] = useState({ toolbar: TOPBAR_H, cardHeader: TOPBAR_H });

  useEffect(() => {
    const measure = () => {
      const toolbarH = toolbarRef.current?.offsetHeight ?? 0;
      setStickyTop({ toolbar: TOPBAR_H, cardHeader: TOPBAR_H + toolbarH });
    };
    measure();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // ⚠ `studentsLoading` added (user, 2026-09-25, same bug class found and
    // fixed on RPC Monitoring): with `[canAddStudent]` alone, this ran once
    // on the very first render -- while studentsLoading is still true and
    // the skeleton renders instead of the real toolbar -- so toolbarRef was
    // null and cardHeader's sticky offset stuck at TOPBAR_H forever, same as
    // the toolbar's own offset. Once both stuck on scroll, the search/filter
    // block would overlap and cover the bottom of the toolbar.
  }, [canAddStudent, studentsLoading]);

  // The Add Student form no longer has its own School field — it always adds
  // to whichever school is currently in view, set the moment the form opens
  // rather than left for the encoder to pick (and possibly get wrong).
  useEffect(() => {
    if (showAddForm) {
      setNewPatient((p) => ({ ...p, school: selectedSchool ?? '' }));
      setMissingFields(new Set());
      setAcknowledgedDuplicateId(null);
      setSectionMenuOpen(false);
    }
  }, [showAddForm, selectedSchool]);

  // Updates one field and, if it was flagged as missing, clears that flag —
  // so the per-field "this field is required" line disappears the moment the
  // person actually fixes it, not only on the next full submit attempt.
  const updateField = <K extends keyof typeof newPatient>(key: K, value: (typeof newPatient)[K]) => {
    setNewPatient((p) => ({ ...p, [key]: value }));
    setMissingFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // Red " *" when the field is CURRENTLY required — reads onlyIf against the
  // live form, not just the field's key, so Grade/Section/Sex lose their
  // asterisk the moment "Not a Student" is checked instead of staying
  // required-looking while actually disabled.
  const req = (key: keyof NewPatientForm) => {
    const field = REQUIRED_STUDENT_FIELDS.find((f) => f.key === key);
    if (!field) return null;
    return (field.onlyIf ? field.onlyIf(newPatient) : true) ? <span className="text-destructive"> *</span> : null;
  };

  const fieldError = (key: keyof NewPatientForm) =>
    missingFields.has(key) ? <p className="mt-1 text-xs text-destructive">This field is required.</p> : null;

  // The only way to close this form — Esc and backdrop-click are disabled
  // (see closeDisabled on the Modal below) so a half-filled form can't be
  // lost by a stray click. Resets everything, so reopening via Add Student
  // starts clean rather than picking up stale values.
  const closeAddForm = () => {
    setShowAddForm(false);
    setNewPatient(BLANK_NEW_PATIENT);
    setMissingFields(new Set());
    setAddPatientError(null);
    setAcknowledgedDuplicateId(null);
    setSectionMenuOpen(false);
    setOcrConfidences({});
    setOcrFindings([]);
    setOcrFindingsNote(null);
    setOcrSourceLabel(null);
  };

  // Gate between "form looks valid" and actually saving. birthdate/gender/
  // address/section are all required on the backend (Student model) and
  // already marked with a red * in this form's labels, but weren't actually
  // enforced here -- a student could be submitted without them, either
  // failing with a raw Mongoose validation error message online, or (worse)
  // queuing successfully offline and only failing to sync later with a
  // confusing 400 -- instead of being caught at entry time like the other
  // required fields already were. ONE source for what is required, shared
  // with the labels below so the asterisks and the check cannot drift apart.
  // They had: Address was enforced but carried no asterisk, and Guardian
  // Name carried an asterisk but was never enforced — exactly inverted.
  const handleAddStudentClick = () => {
    setAddPatientError(null);
    const missing = REQUIRED_STUDENT_FIELDS
      .filter(({ key, onlyIf }) => (onlyIf ? onlyIf(newPatient) : true))
      .filter(({ key }) => !String(newPatient[key] ?? '').trim());
    if (missing.length) {
      setMissingFields(new Set(missing.map((m) => m.key)));
      // Names them too. "Please fill in all required fields" leaves the user
      // hunting, which is what made the missing Address asterisk costly.
      setAddPatientError(`Please fill in: ${missing.map((m) => m.label).join(', ')}.`);
      return;
    }
    setMissingFields(new Set());
    // Values, not just presence (Sprint 120). ⚠ ALL problems at once — fixing
    // them one save at a time is the thing that makes an encoder give up and
    // type whatever passes.
    const valueProblems = validateStudentValues({
      lastName: newPatient.lastName,
      firstName: newPatient.firstName,
      middleName: newPatient.middleName,
      birthdate: newPatient.birthdate,
      contactNumber: newPatient.contactNumber,
      guardianContact: newPatient.guardianContact,
    });
    if (valueProblems.length) {
      setAddPatientError(valueProblems.join(' '));
      return;
    }
    setShowAddConfirm(true);
  };

  // confirmDuplicate is the answer to a previous 409: the encoder has looked at
  // the matches and says this really is a different child. Re-reads `newPatient`
  // rather than caching a payload, so "Save anyway" cannot drift from the form.
  // Validation already happened in handleAddStudentClick (or, for the 409 path,
  // in the attempt that produced the duplicate warning), so this only saves.
  const handleAddStudent = async (confirmDuplicate = false) => {
    setAddPatientError(null);
    setShowAddConfirm(false);
    const school = schools.find((s) => s.school_name === newPatient.school);
    if (!school) {
      setAddPatientError('Selected school not found.');
      return;
    }
    setAddingPatient(true);
    try {
      const created = await apiClient.post<{ _id: string }>('/students', {
        school_id: school._id,
        last_name: newPatient.lastName,
        first_name: newPatient.firstName,
        middle_name: newPatient.middleName,
        birthday: newPatient.birthdate,
        sex: newPatient.gender,
        address: newPatient.address,
        contact_number: newPatient.contactNumber,
        grade_level: newPatient.grade,
        section: newPatient.section,
        is_not_student: newPatient.isNotStudent,
        place_of_birth: newPatient.placeOfBirth,
        guardian_name: newPatient.guardianName,
        guardian_contact: newPatient.guardianContact,
        guardian_occupation: newPatient.guardianOccupation,
        philhealth_number: newPatient.philhealthNumber,
        philhealth_status: newPatient.philhealthNumber.trim() ? newPatient.philhealthStatus : 'None',
        is_4ps: newPatient.is4Ps,
        fourps_id: newPatient.fourPsId,
        ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
      });
      // Open this school year's record straight away (Sprint 69). Adding a
      // student used to create NO IPTR at all — the year record only appeared
      // when someone later opened the chart and clicked "Add Year", so a
      // freshly encoded student had nowhere to hang a medical history, a
      // charting or an RPC visit, and did not appear in any year-scoped report.
      //
      // Grade and section are stamped from the form, which is what 57a made
      // the IPTR carry; consent_status the same way now that consent is
      // per-year rather than a lifetime flag on the student. Best-effort: if
      // this fails the student still exists and "Add Year" still works, so
      // it warns rather than failing the whole save.
      let yearOpened = true;
      try {
        await apiClient.post('/student-iptrs', {
          student_id: created._id,
          school_year: schoolYearLabel(),
          grade_level: newPatient.isNotStudent ? null : newPatient.grade,
          section: newPatient.isNotStudent ? null : newPatient.section,
          consent_status: newPatient.consentStatus,
        });
      } catch {
        yearOpened = false;
      }
      await reloadStudents();
      setDuplicateWarning(null);
      toast.success(
        yearOpened
          ? `Student added: ${newPatient.lastName}, ${newPatient.firstName} · ${schoolYearLabel()} record opened`
          : `Student added: ${newPatient.lastName}, ${newPatient.firstName} — but the ${schoolYearLabel()} record could not be opened. Add it from the chart.`,
      );
      setShowAddForm(false);
      setNewPatient(BLANK_NEW_PATIENT);
      setOcrConfidences({}); setOcrFindings([]); setOcrFindingsNote(null); setOcrSourceLabel(null);
      // Straight into the new record rather than back to the list — the next
      // thing anyone does after adding a student is open their chart.
      navigate(`/dental-chart/${created._id}?tab=history`);
    } catch (err) {
      const duplicates = duplicatesFromError(err);
      // A duplicate isn't an error the encoder can fix by editing the form, so
      // it gets the decision dialog rather than the inline error line.
      if (duplicates) setDuplicateWarning(duplicates);
      else setAddPatientError(err instanceof ApiError ? err.message : 'Failed to add student');
    } finally {
      setAddingPatient(false);
    }
  };

  const ocrFieldClass = (key: IptrOcrFieldKey) => {
    const conf = ocrConfidences[key];
    if (conf === undefined) return plainFieldClass;
    return conf < OCR_CONFIDENCE_THRESHOLD
      ? 'w-full border-2 border-yellow-400 bg-yellow-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500'
      : 'w-full border border-green-300 bg-green-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
  };

  const ocrHint = (key: IptrOcrFieldKey) => {
    const conf = ocrConfidences[key];
    if (conf === undefined) return null;
    return conf < OCR_CONFIDENCE_THRESHOLD
      ? <span className="text-xs text-yellow-700 ml-1">⚠ scanned, please verify ({conf}%)</span>
      : <span className="text-xs text-green-700 ml-1">✓ scanned ({conf}%)</span>;
  };

  // Filter by selected school context
  const schoolStudents = selectedSchool
    ? allStudents.filter(s => s.school === selectedSchool)
    : allStudents;

  // Same signal UpdateSchoolYear.tsx already computes for its own roster
  // (unassignedCount/stillAssignedCount): once "Start New School Year" clears
  // everyone's grade/section, they stay unassigned until Promote/Assign or
  // Bulk Transfer re-settles them into the new year. So "does anyone still
  // need a grade/section" doubles as "has this year's rollover been finished
  // yet" — no separate open/closed flag needed anywhere in the data model.
  const schoolYearNeedsUpdate = schoolStudents.some(s => !s.pending && (!s.grade || !s.section));

  // Every section name already in use anywhere in the school being entered
  // on the Add Student form — real sections come from the whole roster, not
  // a fixed list and not narrowed to the chosen grade (the same section name
  // is often reused across grade levels, and scoping to grade meant nothing
  // suggested at all until a grade was picked first).
  const schoolSectionOptions = useMemo(() => {
    return [...new Set(schoolStudents.filter(s => s.section).map(s => s.section))].sort();
  }, [schoolStudents]);

  // What the Section combobox's suggestion list actually shows — prefix-
  // matched against whatever's typed so far ("s" -> sections STARTING with
  // s, not just containing one), or the full list when the box is empty.
  const filteredSectionOptions = useMemo(() => {
    const q = newPatient.section.trim().toLowerCase();
    if (!q) return schoolSectionOptions;
    return schoolSectionOptions.filter((s) => s.toLowerCase().startsWith(q));
  }, [schoolSectionOptions, newPatient.section]);

  // Live, client-side duplicate check for the Add Student form — distinct
  // from both findDuplicateStudents (the server's create-time 409 check,
  // which excludes middle name and sex) and findDuplicateGroups (the Find
  // Duplicates housekeeping scan). This one runs against the roster already
  // loaded in the browser, purely so the person typing sees a heads-up
  // before filling out the whole form, not just after submitting — the
  // actual "add anyway" decision still goes through the 409 dialog.
  const liveDuplicateMatches = useMemo(() => {
    if (!newPatient.lastName.trim() || !newPatient.firstName.trim() || !newPatient.birthdate || !newPatient.gender) return [];
    const norm = (s: string) => s.trim().toLowerCase();
    return schoolStudents.filter((s) => {
      if (s.pending) return false;
      if (norm(s.lastName) !== norm(newPatient.lastName)) return false;
      if (norm(s.firstName) !== norm(newPatient.firstName)) return false;
      if (norm(s.middleName || '') !== norm(newPatient.middleName || '')) return false;
      if (norm(s.gender) !== norm(newPatient.gender)) return false;
      const day = new Date(s.birthdate);
      return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === newPatient.birthdate;
    });
  }, [schoolStudents, newPatient.lastName, newPatient.firstName, newPatient.middleName, newPatient.birthdate, newPatient.gender]);

  // School view computed data
  const schoolData = [selectedSchool].filter(Boolean).map(school => {
    const students = schoolStudents.filter(s => s.school === school);
    const grades = [...new Set(students.map(s => s.grade))].sort();
    return { name: school, count: students.length, grades };
  });

  const gradesForSchool = selectedSchool
    ? [...new Set(allStudents.filter(s => s.school === selectedSchool).map(s => s.grade))].sort()
    : [];

  const sectionsForGrade = (selectedGrade)
    ? [...new Set(schoolStudents.filter(s => s.grade === selectedGrade).map(s => s.section))].sort()
    : [];

  const studentsForSection = (selectedGrade && selectedSection)
    ? schoolStudents.filter(s => s.grade === selectedGrade && s.section === selectedSection)
    : [];

  // List view filtered
  const allSections = useMemo(() => {
    let base = gradeFilter === NO_GRADE ? schoolStudents.filter(s => !s.grade)
      : gradeFilter !== 'all' ? schoolStudents.filter(s => s.grade === gradeFilter)
      : schoolStudents;
    // The blank grade/section itself never renders as a real option here --
    // it gets its own labeled "No Section" entry instead (see FilterSelect
    // below), not a nameless blank row in the dropdown.
    return [...new Set(base.map(s => s.section))].filter(Boolean).sort();
  }, [gradeFilter]);

  const filtered = useMemo(() => schoolStudents.filter(s => {
    const age = calculateAge(s.birthdate);
    const ag = getAgeGroup(age);
    if (gradeFilter === NO_GRADE) { if (s.grade) return false; }
    else if (gradeFilter !== 'all' && s.grade !== gradeFilter) return false;
    if (sectionFilter === NO_SECTION) { if (s.section) return false; }
    else if (sectionFilter !== 'all' && s.section !== sectionFilter) return false;
    if (genderFilter !== 'all' && s.gender !== genderFilter) return false;
    if (ageGroupFilter !== 'all' && ag !== ageGroupFilter) return false;
    if (searchTerm) {
      const query = searchTerm.toLowerCase();
      const formattedName = s.name.toLowerCase();
      if (!formattedName.includes(query) && !s.grade.toLowerCase().includes(query) && !s.section.toLowerCase().includes(query)) return false;
    }
    return true;
  // schoolStudents was missing from this dependency array -- filtered went
  // stale (kept showing old data) whenever the underlying student list
  // changed for any reason (new pending offline write merged in, a reload
  // after sync, even switching schools) unless a filter dropdown was also
  // touched, since that was the only thing that could trigger a recompute.
  // Default order: grade, then section, then sex (male before female), then
  // surname, then first name — a roster reads this way on paper, and it is
  // what the DOH forms already group by. Client-side only: /stats/student-
  // rows itself stays surname-only, since other consumers of that same
  // endpoint (Reports, the dashboard) rely on that order.
  }).sort((a, b) =>
    (GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade)) ||
    a.section.localeCompare(b.section) ||
    ((GENDER_SORT_ORDER[a.gender] ?? 2) - (GENDER_SORT_ORDER[b.gender] ?? 2)) ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName)
  ), [schoolStudents, gradeFilter, sectionFilter, genderFilter, ageGroupFilter, searchTerm]);

  // Bulk Queue's "All" shortcut + select-all state -- see bulkQueueMode
  // above. Placed here, not with the rest of that block, because it reads
  // `filtered`, which isn't declared until this point in the render.
  const selectableFiltered = useMemo(() => filtered.filter(s => !s.pending), [filtered]);
  const allFilteredSelected = selectableFiltered.length > 0 && selectableFiltered.every(s => tickedIds.has(s.id));
  const toggleSelectAllFilteredQ = () => {
    setActiveGradeCriteriaQ(new Set());
    setActiveSectionCriteriaQ(new Set());
    setTickedIds(allFilteredSelected ? new Set() : new Set(selectableFiltered.map(s => s.id)));
  };

  // ── Pagination (client-side, Sprint 53) ──────────────────────────────────
  // Deliberately paginates the ALREADY-LOADED rows rather than the fetch. The
  // table rendered every row, which is unusable at the ~8,000-student scale in
  // Chapter 1. Slicing here fixes what you SEE without touching what gets
  // DOWNLOADED — so the counts, the filters and the offline queue's assumption
  // that the full set is present all keep working. Reducing the payload is a
  // separate, riskier job (backlog #0b Option 2) and is NOT what this is.
  //
  // Paging now lives in the shared hook (see Pagination.tsx), which also
  // carries the page-size picker. Reset keys are the FILTER INPUTS, not
  // `filtered` — see the hook for why that distinction matters.
  const pager = usePagination(filtered, [gradeFilter, sectionFilter, genderFilter, ageGroupFilter, searchTerm, selectedSchool], 25);
  // "Hide" (user, 2026-09-25, ported from RPC Monitoring): a local toggle
  // layered on top of `pager`, not a value fed into it — `usePagination`
  // slices by dividing into `pageSize`, and a 0 there would divide by zero.
  // Hiding shows every filtered row and drops pager.pageSize entirely.
  const [hidePagination, setHidePagination] = useState(false);
  const paged = hidePagination ? filtered : pager.paged;
  const HIDE_FOOTER = 0;
  const PATIENT_PAGE_SIZE_OPTIONS = [...PAGE_SIZE_OPTIONS, HIDE_FOOTER] as const;

  // ⚠ ADAPTIVE, not JS pixel math for the footer (ported from RPC Monitoring,
  // user 2026-09-25, after three failed attempts THERE at computing an exact
  // height for the rows box AND the footer separately): the CARD itself is
  // measured ONCE (its own `top` — the one thing genuine CSS can't express
  // here, since it depends on the toolbar's rendered height) and given that
  // much of the viewport as a real `height`. Everything below
  // that split is plain CSS flexbox on the card: the sticky search/filter
  // header, the rows box (`flex-1 min-h-0 overflow-auto`), and the footer
  // (an ordinary flex item sized by its own content). The browser recomputes
  // that split on every layout pass — nothing to remeasure, nothing to fall
  // out of sync.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  useEffect(() => {
    // Target the sidebar's OWN rendered bottom edge, not window.innerHeight
    // (user, 2026-09-28, found on the Treatment Queue's twin of this card --
    // a taskbar screenshot showed the sidebar itself stops 20px short of the
    // true viewport edge: Root.tsx's <aside> is `md:top-5 md:bottom-5`, a
    // floating card inset from the screen at desktop widths, not flush to
    // it. Reading #main-nav's real getBoundingClientRect().bottom tracks
    // whatever that inset is (or isn't, below md where the aside is an
    // off-canvas h-screen drawer and its bottom IS window.innerHeight)
    // instead of hardcoding 20px.
    const measure = () => {
      if (!cardRef.current) return;
      const top = cardRef.current.getBoundingClientRect().top;
      const sidebar = document.getElementById('main-nav');
      // Hide wants the card to actually reach the screen's true bottom edge
      // (user, 2026-09-29), not just match the sidebar's own inset -- the
      // sidebar's `md:bottom-5` floating look is a deliberate 20px gap for
      // the DEFAULT view, but the negative margin below only cancels
      // `<main>`'s padding, it doesn't add back that 20px, so matching the
      // sidebar here left Hide 20px short of the edge it's supposed to flow to.
      const bottomTarget = !hidePagination && sidebar ? sidebar.getBoundingClientRect().bottom : window.innerHeight;
      setCardHeight(Math.max(bottomTarget - top, 160));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // studentsLoading: same reason as the stickyTop effect above. hidePagination
    // (missed when this was first ported -- RPC Monitoring's own measure
    // effect has the equivalent `pageSize`): without it, toggling Hide never
    // re-measures a fresh baseline, so the card kept the DEFAULT view's
    // already-shrunk cardHeight (correction only ever shrinks, never grows
    // it back), and the negative margin that should let it reach the true
    // edge had nothing left to cancel.
  }, [canAddStudent, studentsLoading, hidePagination]);

  // The estimate above can leave a few stray pixels of page scroll (e.g.
  // `<main>`'s own bottom padding, which this component has no clean way to
  // read). Trim exactly that much, synchronously before paint, so the page
  // itself never scrolls — only the bounded row list above does.
  //
  // ⚠ `hidePagination` is ALSO a dep, not just `cardHeight` (same bug class
  // found and fixed on RPC Monitoring): toggling Hide can remeasure to the
  // EXACT SAME cardHeight value (both are `window.innerHeight - top`, and
  // `top` doesn't move between states) — React bails out the resulting
  // setCardHeight as a no-op, so this effect would never get a second look
  // at the real footer's overflow once Hide's negative margin is gone.
  useLayoutEffect(() => {
    if (cardHeight == null) return;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow > 0) {
      setCardHeight((h) => (h == null ? h : Math.max(h - overflow, 160)));
    }
  }, [cardHeight, hidePagination]);

  // Hide's bottom corners: rounded when the rows fit without scrolling (a
  // short list, with blank card interior above the pinned reveal tab),
  // square when the rows box is actually scrolling internally (a long list
  // past the card's fixed height) — a curve right at the screen edge, with
  // nothing beneath it, reads as a cut-off render glitch rather than a
  // corner. `useLayoutEffect`, not `useEffect`: a passive effect runs after
  // the browser paints, flashing the rounded corner for one frame first.
  const rowsBoxRef = useRef<HTMLDivElement | null>(null);
  const [hideAtEdge, setHideAtEdge] = useState(false);
  useLayoutEffect(() => {
    if (!hidePagination) { setHideAtEdge(false); return; }
    const el = rowsBoxRef.current;
    if (!el) return;
    const check = () => setHideAtEdge(el.scrollHeight > el.clientHeight + 1);
    check();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    resizeObserver?.observe(el);
    return () => resizeObserver?.disconnect();
  }, [hidePagination, cardHeight, filtered.length]);

  const hasActiveFilters = gradeFilter !== 'all' || sectionFilter !== 'all' || genderFilter !== 'all' || ageGroupFilter !== 'all' || searchTerm !== '';

  const clearFilters = () => {
    setGradeFilter('all'); setSectionFilter('all');
    setGenderFilter('all'); setAgeGroupFilter('all'); setSearchTerm('');
  };

  // Exports exactly what's currently visible (respects active filters) --
  // excludes not-yet-synced offline rows since they don't have a real ID yet.

  const riskBadge = (level: string) => {
    const c: Record<string,string> = { 'High':'bg-red-100 text-red-800', 'Medium':'bg-yellow-100 text-yellow-800', 'Low':'bg-green-100 text-green-800' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c[level]||'bg-gray-100 text-foreground'}`}>{level}</span>;
  };

  const statusBadge = (status: string) => {
    const c: Record<string,string> = { 'Orally Fit':'bg-green-100 text-green-800', 'Needs Treatment':'bg-red-100 text-red-800', 'Under Treatment':'bg-blue-100 text-blue-800', 'Needs Follow-up':'bg-yellow-100 text-yellow-800' };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c[status]||'bg-gray-100 text-foreground'}`}>{status}</span>;
  };

  const FilterSelect = ({ value, onChange, options, label }: { value: string; onChange: (v:string) => void; options: {value:string;label:string}[]; label: string }) => (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm border border-transparent rounded-full px-4 py-2 bg-canvas text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
      <option value="all">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const SchoolCard = ({ school, count, onClick }: { school: string; count: number; onClick: () => void }) => {
    const sc = getSchoolColor(school);
    return (
      <button onClick={onClick} style={{ borderColor: sc.border }} className="w-full text-left bg-card rounded-xl border-2 p-5 hover:shadow-md transition-all group">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div style={{ backgroundColor: sc.light }} className="w-10 h-10 rounded-lg flex items-center justify-center">
              <SchoolIcon style={{ color: sc.solid }} className="w-5 h-5" />
            </div>
            <div>
              <div style={{ color: sc.text }} className="font-bold text-sm">{school}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{count} students enrolled</div>
            </div>
          </div>
          <ChevronRight style={{ color: sc.solid }} className="w-5 h-5 transition-colors" />
        </div>
        <div style={{ backgroundColor: sc.light, color: sc.text }} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold">
          {getSchoolShortName(school)}
        </div>
      </button>
    );
  };

  const Breadcrumb = () => {
    if (!selectedGrade && !selectedSection) return null;
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <button onClick={() => { setSelectedGrade(null); setSelectedSection(null); }} className="hover:text-primary">All Schools</button>
        {selectedGrade && <><ChevronRight className="w-4 h-4" /><button onClick={() => { setSelectedGrade(null); setSelectedSection(null); }} style={{ color: selectedSchool ? getSchoolColor(selectedSchool).solid : undefined }} className="truncate max-w-[160px] font-medium">{selectedSchool ? getSchoolShortName(selectedSchool) : ''}</button></>}
        {selectedGrade && <><ChevronRight className="w-4 h-4" /><button onClick={() => setSelectedSection(null)} className="hover:text-primary"><GradePill grade={selectedGrade} /></button></>}
        {selectedSection && <><ChevronRight className="w-4 h-4" /><span className="text-foreground font-medium">{selectedSection}</span></>}
      </div>
    );
  };

  if (studentsLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading students">
        <SkeletonPageHeader />
        <SkeletonTable rows={7} />
      </div>
    );
  }

  // Decorative kicker above the page title — reuses the same school color
  // tokens as SchoolCard/GradePill rather than inventing a new palette. Shows
  // the school's full registered name, not the abbreviated short form.
  const kickerColor = selectedSchool
    ? getSchoolColor(selectedSchool)
    : { name: 'All Schools', solid: '#1E40AF', light: '#EFF6FF', text: '#1E40AF', border: '#93C5FD' };
  const kickerLabel = selectedSchool ?? 'All Schools';

  // Two-letter initials for the row avatar — same derivation already used for
  // the Dashboard's follow-up list, so a name reads the same way everywhere.
  const initials = (name: string) =>
    name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="space-y-3">
      {/* No export here by design (2026-09-02): this list is raw patient
          PII — names, birthdays, addresses, guardians — and a CSV of it
          would leave the encrypted database as plaintext on someone's
          device, defeating the field encryption. Official OUTPUT is the
          DOH report on Reports, which is aggregate counts and carries no
          names. */}
      {canAddStudent && (
        <div ref={toolbarRef} className="sticky z-40 -mt-3 flex flex-wrap items-center justify-end gap-3 bg-gray-50 pb-2" style={{ top: stickyTop.toolbar }}>
          {/* "Upload", not "Scan": this opens a file picker, and a scan icon
              + the verb "scan" both promised a camera the app does not have
              (backlog 0e). The OCR extraction is still described inside the
              modal — only the entry point stops over-promising. Rename this
              back if 0e ever ships. Kept standalone (user, 2026-09-29: "I
              never said delete, I just said add") alongside Add Student's
              own OCR option below, not replaced by it. */}
          <button onClick={() => navigate('/students/scan')} className="flex items-center gap-2 px-4 py-2 border border-primary text-primary rounded-full hover:bg-primary-surface text-sm font-medium">
            <Upload className="w-4 h-4" /> OCR
          </button>
          {/* Add Student also offers OCR as a second entry point (designed on
              the OCR Student Intake canvas). Portaled to document.body, not
              rendered in place: this toolbar is itself `sticky z-40`, which
              opens its OWN stacking context, so a `fixed` menu nested inside
              it is scoped to THAT context — it then loses the paint-order
              tie against the results card's `sticky z-40` header (same
              z-index, later in the DOM) and renders visually underneath the
              card instead of on top of it. A portal escapes that entirely. */}
          <div className="relative">
            <button
              ref={addMenuBtnRef}
              onClick={toggleAddMenu}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-full hover:bg-primary-hover text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Add Student
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAddMenu ? 'rotate-180' : ''}`} />
            </button>
            {showAddMenu && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                <div
                  style={addMenuAt ? { top: addMenuAt.top, right: addMenuAt.right } : undefined}
                  className="fixed z-50 w-64 overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
                >
                  <button
                    onClick={() => { setShowAddMenu(false); setOcrConfidences({}); setOcrFindings([]); setOcrFindingsNote(null); setOcrSourceLabel(null); setShowAddForm(true); }}
                    className="flex w-full items-start gap-3 px-3.5 py-3 text-left hover:bg-canvas"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-surface text-primary">
                      <Plus className="w-4 h-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">Add Manually</span>
                      <span className="block text-xs text-muted-foreground">Fill in a blank student form</span>
                    </span>
                  </button>
                  <div className="mx-3.5 border-t border-border" />
                  <button
                    onClick={() => { setShowAddMenu(false); navigate('/students/scan'); }}
                    className="flex w-full items-start gap-3 px-3.5 py-3 text-left hover:bg-canvas"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-surface text-primary">
                      <Upload className="w-4 h-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">Scan Form (OCR)</span>
                      <span className="block text-xs text-muted-foreground">Take a photo or upload a file</span>
                    </span>
                  </button>
                </div>
              </>,
              document.body,
            )}
          </div>
        </div>
      )}

      {/* LIST VIEW — one elevated card housing header, filters, table and
          pagination, in place of the previous stack of separate boxes. */}
      {/* `overflow-clip`, not `overflow-hidden` (see Root.tsx's own note on the
          same distinction) — `hidden` makes this div a scroll container, which
          is what `position: sticky` pins its descendants against, so the
          header block, table headings and footer below would stick to THIS
          div instead of the viewport and never visibly move. */}
      {/* Hide uses `maxHeight`, not `height` (user, 2026-09-29: "when there
          is only two [students], the container would end in that" -- a
          short filtered list must shrink-wrap to its real content, not
          stretch to fill the screen with blank interior). This only works
          now that the reveal tab lives INSIDE the scrollable rows box
          (see below) rather than as its own flush-bottom footer sibling --
          with the tab inside, a short list simply ends after it; a long
          list caps at `cardHeight` and scrolls internally, tab included. */}
      <div ref={cardRef} className={`flex flex-col bg-card border border-border shadow-sm overflow-clip ${hideAtEdge ? 'rounded-t-2xl' : 'rounded-2xl'} ${hidePagination ? '-mb-4 md:-mb-8' : ''}`} style={{ [hidePagination ? 'maxHeight' : 'height']: cardHeight ?? undefined }}>
        <div ref={cardHeaderRef} className="sticky z-40 space-y-4 border-b border-border bg-card p-5 sm:p-6" style={{ top: stickyTop.cardHeader }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 mb-2">
                <span style={{ backgroundColor: kickerColor.light }} className="w-6 h-6 rounded-md grid place-items-center">
                  <SchoolIcon style={{ color: kickerColor.solid }} className="w-3.5 h-3.5" />
                </span>
                <span style={{ color: kickerColor.solid }} className="text-xs font-bold uppercase tracking-wider">{kickerLabel}</span>
              </div>
              <h1 className="text-2xl font-bold text-foreground">Student Records</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{schoolStudents.length} students{selectedSchool ? '' : ' across 3 schools'}</p>
            </div>
            {/* Annual rollover — was "Promote / Assign" (a modal, one grade
                at a time). Now a full page: school-wide clear + reassign +
                archive, see UpdateSchoolYear.tsx. Sits top-right of this card,
                level with the school kicker, because it acts on THIS roster. */}
            {canAddStudent && (
              <button
                onClick={() => navigate('/students/update-school-year')}
                title="Update School Year Information"
                aria-label="Update School Year Information"
                className={`shrink-0 p-2 rounded-full text-white shadow-sm transition-colors hover:brightness-110 ${
                  schoolYearNeedsUpdate ? 'bg-gray-400' : 'bg-primary'
                }`}
              >
                <GraduationCap className="w-6 h-6 text-white/90" strokeWidth={1.25} />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <ListSearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search student, grade, or section" />
            <FilterSelect value={gradeFilter} onChange={v => { setGradeFilter(v); setSectionFilter('all'); }} label="All Grades"
              options={[{ value: NO_GRADE, label: 'No Grade' }, ...GRADES.map(g => ({ value: g, label: g }))]} />
            <FilterSelect value={sectionFilter} onChange={setSectionFilter} label="All Sections"
              options={[{ value: NO_SECTION, label: 'No Section' }, ...allSections.map(s => ({ value: s, label: s }))]} />
            <FilterSelect value={genderFilter} onChange={setGenderFilter} label="All Genders"
              options={[{ value:'Male', label:'Male' }, { value:'Female', label:'Female' }]} />
            <FilterSelect value={ageGroupFilter} onChange={setAgeGroupFilter} label="All Age Groups"
              options={[{ value:'4 & below', label:'4 & below' }, { value:'5-9', label:'5-9' }, { value:'10-14', label:'10-14' }, { value:'15-19', label:'15-19' }, { value:'20 & above', label:'20 & above' }]} />
            {hasActiveFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-destructive border border-destructive/20 rounded-full hover:bg-danger-surface">
                <X className="w-3 h-3" /> Clear All
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {selectMode && tickedIds.size > 0 && (
                <button
                  onClick={() => { setArchivePassword(''); setArchivePasswordError(null); setConfirmArchiveTicked(true); }}
                  title="Archive"
                  aria-label={`Archive ${tickedIds.size} selected`}
                  className="p-2 rounded-full border border-destructive text-destructive hover:bg-danger-surface"
                >
                  <ArchiveIcon className="w-4 h-4" />
                </button>
              )}
              {selectMode ? (
                <button onClick={exitSelectMode}
                  className="text-sm font-medium text-foreground border border-border rounded-full px-3 py-2 hover:bg-canvas">
                  Done
                </button>
              ) : (
                <div className="relative">
                  <button
                    ref={listMenuBtnRef}
                    onClick={toggleListMenu}
                    disabled={bulkQueueMode}
                    className={`p-2 rounded-full ${bulkQueueMode ? 'text-muted-foreground/40 cursor-not-allowed' : 'text-muted-foreground hover:bg-canvas hover:text-foreground'}`}
                    title="More options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {showListMenu && !bulkQueueMode && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowListMenu(false)} />
                      {/* ⚠ FIXED, not absolute. This card is `overflow-hidden`,
                          and a clipping ancestor cuts an absolutely positioned
                          menu off at its edge — the school-year menu looked like
                          a dead button for exactly that reason. Positioned from
                          the trigger's own rect so no ancestor can clip it. */}
                      {/* Hugs its content width (user, 2026-09-27) -- was a
                          fixed w-44 wider than any of these three labels
                          need. Title Case, no trailing ellipsis. Order:
                          Archive Students, Find Duplicates, Queue (user,
                          2026-09-27 -- Queue moved last; "Select Students"
                          renamed to "Archive Students" since that's the
                          only thing this mode's select-then-act flow does). */}
                      <div
                        style={listMenuAt ? { top: listMenuAt.top, right: listMenuAt.right } : undefined}
                        className="fixed z-50 bg-card border border-border rounded-xl shadow-md py-1 w-max"
                      >
                        <button
                          onClick={() => { setSelectMode(true); setShowListMenu(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-canvas flex items-center gap-2"
                        >
                          <ListChecks className="w-3.5 h-3.5" /> Archive Students
                        </button>
                        <button
                          onClick={() => { setShowListMenu(false); setShowDuplicates(true); void loadDuplicates(); }}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-canvas flex items-center gap-2"
                        >
                          <Copy className="w-3.5 h-3.5" /> Find Duplicates
                        </button>
                        {/* Queue (user, 2026-09-27): the Bulk Queue
                            counterpart to Dental Charts' own Dequeue flow --
                            a SEPARATE mode from "Archive Students" above, not
                            another action inside it. Turns on bulkQueueMode,
                            which reveals checkboxes AND makes each row's
                            Grade/Section clickable, plus the dark bar below
                            the header (see bulkQueueMode block after the
                            table). */}
                        <button
                          onClick={() => { setBulkQueueMode(true); setShowListMenu(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-canvas flex items-center gap-2"
                        >
                          <ListPlus className="w-3.5 h-3.5" /> Queue
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bulk Queue's dark selection bar (user, 2026-09-27): only while
            bulkQueueMode is on. Same shape as Dental Charts' own bar --
            count/instructions, "All", removable Grade/Section criteria
            pills, Queue, Cancel. */}
        {bulkQueueMode && (
          <div className="px-5 sm:px-6 py-2.5 bg-foreground flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-normal text-white">
              {tickedIds.size > 0 ? `${tickedIds.size} selected` : 'Check rows or click a Grade/Section badge to select'}
            </span>
            <button
              onClick={toggleSelectAllFilteredQ}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal ${
                allFilteredSelected ? 'bg-white text-foreground' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              All
            </button>
            {Array.from(activeGradeCriteriaQ).map((g) => (
              <button
                key={`g-${g}`}
                onClick={() => toggleGradeCriterionQ(g)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white px-2.5 py-1 text-xs font-normal hover:bg-white/20"
              >
                {g} <X className="w-3 h-3" />
              </button>
            ))}
            {Array.from(activeSectionCriteriaQ).map((s) => (
              <button
                key={`s-${s}`}
                onClick={() => toggleSectionCriterionQ(s)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white px-2.5 py-1 text-xs font-normal hover:bg-white/20"
              >
                {s} section <X className="w-3 h-3" />
              </button>
            ))}
            <div className="flex-1" />
            <button
              disabled={tickedIds.size === 0}
              onClick={bulkQueueTicked}
              className={`rounded-lg px-3 py-1.5 text-xs font-normal ${
                tickedIds.size === 0 ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-primary text-white hover:opacity-90'
              }`}
            >
              Queue
            </button>
            <button onClick={exitBulkQueueMode} className="text-xs font-normal text-white/60 hover:text-white">
              Cancel
            </button>
          </div>
        )}

        {/* flex-1 fills whatever the card (see cardRef above) doesn't give
            to the header/footer — this box (not the page) is what scrolls,
            even when there are only a few rows. The column headings stick to
            the TOP OF THIS BOX via `sticky` on each `<th>`, not the `<tr>` —
            a sticky `<tr>` rendered as a visual duplicate mid-table in some
            browsers. */}
        <div ref={rowsBoxRef} className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 sm:pl-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {/* The row-number column doubles as "select all" once select
                      mode is on — same swap as each row's own cell, scoped to
                      the current page: now that the table paginates, ticking
                      everything in the filtered set would tick rows the user
                      cannot see. */}
                  {selectMode || bulkQueueMode ? (
                    <input
                      type="checkbox"
                      aria-label="Select all students on this page"
                      checked={paged.length > 0 && paged.every(s => s.pending || tickedIds.has(s.id))}
                      onChange={(e) => {
                        if (e.target.checked) setTickedIds(new Set(paged.filter(s => !s.pending).map(s => s.id)));
                        else setTickedIds(new Set());
                      }}
                      className="w-4 h-4 accent-primary align-middle"
                    />
                  ) : '#'}
                </th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Student</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Risk</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grade</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Section</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gender</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Age</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="sticky top-0 z-10 bg-gray-100 text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.length === 0 ? (
                <tr><td colSpan={9}className="text-center py-14 text-muted-foreground">{hasActiveFilters ? <>No students match your filters. <button onClick={clearFilters} className="text-primary hover:underline font-medium">Clear filters</button></> : 'No students at this school yet — use Add Student to register one.'}</td></tr>
              ) : paged.map((student, i) => {
                const age = calculateAge(student.birthdate);
                const queuePosition = queuedStudentIds.indexOf(student.id);
                const isQueued = queuePosition !== -1;
                const gc = getGradeColor(student.grade);
                return (
                  <tr key={student.id} {...activatable(() => { if (!student.pending) navigate(`/dental-chart/${student.id}?tab=history`); })} className={`hover:bg-canvas transition-colors cursor-pointer ${student.pending ? 'opacity-70' : ''}`}>
                    <td className="px-4 py-2.5 sm:pl-6 text-xs text-muted-foreground tabular-nums" onClick={(e) => e.stopPropagation()}>
                      {selectMode || bulkQueueMode ? (
                        !student.pending && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${student.name}`}
                            checked={tickedIds.has(student.id)}
                            onChange={() => toggleTicked(student.id)}
                            className="w-4 h-4 accent-primary align-middle"
                          />
                        )
                      ) : pager.from + i}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-foreground">
                      <div className="flex items-center gap-3">
                        <span style={{ backgroundColor: gc.light, color: gc.solid }} className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-xs font-bold">
                          {initials(student.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate">{student.name}</p>
                          {student.pending && (
                            <span className="inline-flex items-center mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-warning-surface text-warning border border-warning/20">Pending Sync</span>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* The row opens the chart on click AND on Enter/Space
                        (activatable). The chip's card and review dialog render
                        inside this cell, so both must stop here, or typing a
                        space in the review notes would navigate away. */}
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      {!student.pending && (
                        <StudentRiskChip studentId={student.id} review={student.riskReview} canSave={user?.role === 'dentist'} onSaved={reloadStudents} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      {bulkQueueMode && !student.pending ? (
                        <button
                          onClick={() => toggleGradeCriterionQ(student.grade)}
                          title={activeGradeCriteriaQ.has(student.grade) ? `Deselect all of ${student.grade}` : `Select all of ${student.grade}`}
                          className={`rounded-full ${activeGradeCriteriaQ.has(student.grade) ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-primary/30'}`}
                        >
                          <GradePill grade={student.grade} />
                        </button>
                      ) : (
                        <GradePill grade={student.grade} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                      {bulkQueueMode && !student.pending ? (
                        <button
                          onClick={() => toggleSectionCriterionQ(student.section)}
                          title={activeSectionCriteriaQ.has(student.section) ? `Deselect ${student.section} section` : `Select all of ${student.section} section`}
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeSectionCriteriaQ.has(student.section) ? 'bg-foreground text-white' : 'bg-gray-100 text-foreground hover:bg-gray-200'}`}
                        >
                          {student.section}
                        </button>
                      ) : (
                        student.section
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{student.gender}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{age ?? '—'}</td>
                    <td className="px-4 py-2.5">{!student.pending && <PipelineStatusPill status={student.pipelineStatus} isRpcDueThisMonth={rpcDueThisMonthIds.has(student.id)} />}</td>
                    <td className="px-4 py-2.5 sm:pr-6">
                      {!student.pending && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isQueued) {
                              setDequeueTarget({ id: student.id, name: student.name });
                            } else {
                              setQueuedStudentIds(addQueuedStudentId(student.id));
                              toast.success(`${student.name} is queued.`);
                            }
                          }}
                          title="Queue"
                          className={`inline-flex items-center justify-center w-16 h-8 rounded-full text-xs font-semibold border transition-colors ${
                            isQueued
                              ? 'bg-success-surface text-success border-success/20 hover:bg-danger-surface hover:text-destructive hover:border-destructive/20'
                              : 'bg-primary-surface text-primary border-primary/20 hover:bg-primary/10'
                          }`}
                        >
                          {isQueued ? queuePosition + 1 : 'Queue'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Reveal tab back INSIDE the scrollable rows box (user, 2026-09-29,
              overriding the "pinned as its own footer" version this
              superseded — "it should NEVER be fixed in the page"): as a
              flex/sticky-footer sibling of this box it stayed on screen at a
              fixed spot while you scrolled the rows past it, which is
              exactly the "fixed in the page" behaviour objected to. Inside
              the scroll container, it scrolls WITH the rows and only comes
              into view once you actually reach the true end of the list. */}
          {hidePagination && (
            <button
              type="button"
              onClick={() => setHidePagination(false)}
              title="Show pagination controls"
              className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-canvas hover:text-foreground"
            >
              <ChevronUp className="h-3 w-3" /> Show pagination controls
            </button>
          )}
        </div>

        {/* Footer / pagination — sits right after the bounded, scrollable
            row list above, so it is always in view without its own sticky
            positioning. */}
        {!hidePagination && filtered.length > 0 && (
          <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>
                Showing <span className="font-semibold text-foreground">{pager.from}</span> to{' '}
                <span className="font-semibold text-foreground">{pager.to}</span> of{' '}
                <span className="font-semibold text-foreground">{pager.total}</span> students
                {filtered.length !== schoolStudents.length ? ` (filtered from ${schoolStudents.length})` : ''}
                {selectedSchool ? ` at ${selectedSchool}` : ''}
              </span>
              {/* Literal glyph, not a CSS-drawn bar (2026-09-25: user wants
                  "like a normal |" -- thinner than any solid bar reads). */}
              <span aria-hidden="true" className="hidden text-3xl font-thin leading-none align-middle text-gray-300 sm:inline-block">|</span>
              <label htmlFor="patients-page-size" className="whitespace-nowrap text-sm font-normal">Items per page</label>
              <select
                id="patients-page-size"
                aria-label="Items per page"
                value={pager.pageSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n === HIDE_FOOTER) { setHidePagination(true); return; }
                  pager.changePageSize(n);
                }}
                className="rounded-full border border-border bg-canvas px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {PATIENT_PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n === HIDE_FOOTER ? 'Hide' : n}</option>)}
              </select>
            </div>
            {pager.pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => pager.setPage(Math.max(1, pager.page - 1))}
                  disabled={pager.page === 1}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <span className="rounded-full bg-primary-surface px-3 py-1.5 text-sm font-semibold text-primary tabular-nums">{pager.page} / {pager.pageCount}</span>
                <button
                  onClick={() => pager.setPage(Math.min(pager.pageCount, pager.page + 1))}
                  disabled={pager.page === pager.pageCount}
                  className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-canvas disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Find Duplicates — a housekeeping scan over already-saved records,
          separate from the create-time 409 check above. Grouped by
          normalized name + birthday + sex; see studentDuplicates.ts. */}
      {showDuplicates && (
        <Modal onClose={() => setShowDuplicates(false)} maxWidth="max-w-2xl">
          <div className="flex items-center justify-between p-6 border-b">
            <h2 className="text-lg font-bold text-foreground">Possible Duplicate Records</h2>
            <button onClick={() => setShowDuplicates(false)} className="text-muted-foreground hover:text-muted-foreground"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Matched on name, birthday and sex{selectedSchool ? ` at ${getSchoolShortName(selectedSchool)}` : ' across all schools'}. Review each group before archiving — a false match here just wastes a click, but archiving the wrong record does not.
            </p>
            {duplicatesLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Scanning records…</p>
            ) : duplicatesError ? (
              <p className="text-sm text-destructive py-8 text-center">{duplicatesError}</p>
            ) : duplicateGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No likely duplicates found.</p>
            ) : (
              <div className="space-y-4">
                {duplicateGroups.map((group) => (
                  <div key={group.map((s) => s._id).join('-')} className="border border-border rounded-xl overflow-hidden">
                    <div className="bg-warning-surface text-warning text-xs font-semibold px-3 py-1.5">
                      {group.length} records look like the same child
                    </div>
                    <div className="divide-y divide-border">
                      {group.map((s) => (
                        <div key={s._id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{s.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.grade_level} · {s.section} · {s.sex} · {formatDate(s.birthday)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => navigate(`/dental-chart/${s._id}?tab=history`)}
                              title="View chart"
                              className="p-2 rounded-full border border-border text-muted-foreground hover:bg-canvas hover:text-foreground"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => archiveOneDuplicate(s._id)}
                              title="Archive"
                              className="p-2 rounded-full border border-destructive text-destructive hover:bg-danger-surface"
                            >
                              <ArchiveIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Scan Form (OCR) is a full page now, not a modal (2026-09-29, user:
          "restructure everything... make it a page") -- see
          ScanStudentForm.tsx / VerifyStudentForm.tsx at /students/scan and
          /students/scan/review, an exact build of the approved canvas
          design. Both toolbar entry points above navigate there. */}

      {/* Add Student Modal. maxWidth is max-w-4xl, not max-w-2xl — the
          request was "50-60% of the screen on web/tablet, so there's less
          to scroll." A raw viewport percentage (e.g. 55vw) does that on a
          laptop but backfires on an iPad-width tablet, where 55vw is
          narrower than the 2-column layout needs; a bigger FIXED cap
          already behaves the same way as a percentage on anything narrower
          than the cap (fills available width, same as before) while
          landing in roughly that 50-60% range on the common 1440-1920px
          desktop range specifically. */}
      {showAddForm && (
        <Modal onClose={closeAddForm} maxWidth="max-w-4xl" closeDisabled>
            {/* sticky, not just fixed at the top of the flow -- the dialog
                itself (Modal.tsx) is the scrolling container (overflow-y-auto
                directly on it), so `sticky top-0` pins this against ITS
                scroll, not the page's. bg-card keeps scrolled-past content
                from showing through underneath. */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 p-6 border-b bg-card">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Basic Information
                </div>
                <h2 className="text-lg font-bold text-foreground">Add New Student</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={closeAddForm} className="text-muted-foreground hover:text-muted-foreground"><X className="w-5 h-5" /></button>
              </div>
            </div>
            {/* "Not a Student" -- e.g. a sibling or community member treated
                at a Bayanihan mission, not actually enrolled. Grade and
                Section don't apply to that person, so checking this clears
                and disables those two. Sex still applies regardless and stays
                enabled/required either way. Placed at the very top, above
                every field, so it's seen before Grade is ever filled in. */}
            <div className="mx-6 mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                id="isNotStudent"
                checked={newPatient.isNotStudent}
                onChange={e => {
                  const checked = e.target.checked;
                  setNewPatient(p => ({ ...p, isNotStudent: checked, grade: checked ? '' : p.grade, section: checked ? '' : p.section }));
                  setMissingFields(prev => {
                    if (!checked) return prev;
                    const next = new Set(prev);
                    next.delete('grade'); next.delete('section');
                    return next;
                  });
                }}
                className="w-4 h-4 rounded accent-primary"
              />
              <label htmlFor="isNotStudent" className="text-sm font-medium text-foreground">Not a Student</label>
            </div>
            {/* Live check against the roster already loaded in the browser —
                a heads-up before the form is even finished, not a
                replacement for the server's 409 check on submit. Its own
                dismiss X (or "Confirm different student") remembers THIS
                match by id, so it stays quiet once handled but reappears on
                its own if the fields change to match a different student. */}
            {liveDuplicateMatches.length > 0 && liveDuplicateMatches[0].id !== acknowledgedDuplicateId && (
              <div className="mx-6 mt-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-danger-surface px-3 py-2.5 text-destructive">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 text-xs font-semibold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Possible duplicate
                  </p>
                  <p className="mt-0.5 text-xs leading-snug">
                    {liveDuplicateMatches[0].name} is already on file, born {formatDate(liveDuplicateMatches[0].birthdate)}. Confirm if this is a different student.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowConfirmDifferentStudent(true)}
                    className="mt-1.5 rounded-full border border-destructive/30 bg-card px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-danger-surface"
                  >
                    Confirm different student
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setAcknowledgedDuplicateId(liveDuplicateMatches[0].id)}
                  title="Dismiss"
                  className="shrink-0 text-destructive/70 hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="p-6 space-y-4">
              {Object.keys(ocrConfidences).length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
                  <ScanLine className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>Pre-filled from a scanned form. Fields outlined in yellow had low scan confidence — double-check them before saving.</span>
                </div>
              )}
              {/* Spreadsheet path has no scan confidence to caveat — it's a
                  direct read of typed text, not a probabilistic OCR guess —
                  so it gets its own banner instead of piggybacking on the
                  yellow/green field-confidence one above. */}
              {ocrSourceLabel === 'uploaded file' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
                  <ScanLine className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>Pre-filled from the uploaded file's columns. Compare against the source and correct anything before saving.</span>
                </div>
              )}
              {/* Medical / dietary / oral findings read off the form's Year 1-5
                  tick grid. Deliberately READ-ONLY: this is clinical history
                  detected by a tick reader, and nothing here is written to the
                  record. The encoder carries it into the dental chart, where a
                  clinician confirms it. */}
              {ocrFindings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <ScanLine className="w-3.5 h-3.5" />
                    {ocrFindings.length} finding{ocrFindings.length === 1 ? '' : 's'} read from the form&rsquo;s checkboxes — not saved
                  </p>
                  <ul className="space-y-0.5">
                    {ocrFindings.map((f) => (
                      <li key={f.label} className="flex items-baseline justify-between gap-3">
                        <span className={f.field === null ? 'line-through opacity-70' : ''}>{f.label}</span>
                        <span className="shrink-0 opacity-80">Year {f.years.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="opacity-80">
                    Record these in the student&rsquo;s dental chart after saving — they are shown here for checking, not applied.
                  </p>
                </div>
              )}
              {ocrFindingsNote && (
                <p className="text-xs text-muted-foreground">{ocrFindingsNote}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-foreground mb-1">Last Name{req('lastName')} {ocrHint('lastName')}</label><input type="text" value={newPatient.lastName} onChange={e => updateField('lastName', e.target.value.toUpperCase())} className={ocrFieldClass('lastName')} />{fieldError('lastName')}</div>
                <div><label className="block text-sm font-medium text-foreground mb-1">First Name{req('firstName')} {ocrHint('firstName')}</label><input type="text" value={newPatient.firstName} onChange={e => updateField('firstName', e.target.value.toUpperCase())} className={ocrFieldClass('firstName')} />{fieldError('firstName')}</div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium text-foreground mb-1">Middle Name {ocrHint('middleName')}</label><input type="text" value={newPatient.middleName} onChange={e => updateField('middleName', e.target.value.toUpperCase())} className={ocrFieldClass('middleName')} /></div>
                <div><label className="block text-sm font-medium text-foreground mb-1">Birthdate{req('birthdate')} {ocrHint('birthdate')}</label><input type="date" value={newPatient.birthdate} onChange={e => updateField('birthdate', e.target.value)} className={ocrFieldClass('birthdate')} />{fieldError('birthdate')}</div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Age</label>
                  <input type="text" readOnly disabled value={newPatient.birthdate ? (calculateAge(newPatient.birthdate) ?? '—') : ''} placeholder="Automatically calculated" className={`${plainFieldClass} bg-muted text-muted-foreground cursor-not-allowed`} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Sex{req('gender')} {ocrHint('gender')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Male', 'Female'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => updateField('gender', g)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                        newPatient.gender === g
                          ? 'bg-primary text-white border-primary-hover'
                          : 'border-border text-foreground hover:bg-canvas'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                {fieldError('gender')}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* No scan hint on Grade/Section: the DOH IPTR does not print
                    either field, so a scan can never fill them. A green "✓
                    scanned" chip here would have been a claim about a field
                    that isn't on the paper. */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Grade{req('grade')}</label>
                  <select value={newPatient.grade} disabled={newPatient.isNotStudent} onChange={e => updateField('grade', e.target.value)}
                    className={`${plainFieldClass} ${newPatient.isNotStudent ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}>
                    <option value="">Select Grade</option>{GRADES.map(g => <option key={g}>{g}</option>)}
                  </select>
                  {fieldError('grade')}
                </div>
                <div className="relative">
                  <label className="block text-sm font-medium text-foreground mb-1">Section{req('section')}</label>
                  {/* Combobox, not a plain <select> — section names come from
                      the roster rather than a fixed list, so typing filters
                      the suggestions AND, if nothing matches, just becomes
                      the new section name. onMouseDown (not onClick) on the
                      suggestion buttons fires before the input's onBlur, so
                      a click actually registers instead of the list closing
                      first. */}
                  <input
                    type="text"
                    value={newPatient.section}
                    disabled={newPatient.isNotStudent}
                    onChange={e => { updateField('section', e.target.value); setSectionMenuOpen(true); }}
                    onFocus={() => setSectionMenuOpen(true)}
                    onBlur={() => setSectionMenuOpen(false)}
                    placeholder="Search or add a section"
                    autoComplete="off"
                    className={`${plainFieldClass} ${newPatient.isNotStudent ? 'bg-muted text-muted-foreground cursor-not-allowed' : ''}`}
                  />
                  {!newPatient.isNotStudent && sectionMenuOpen && (
                    <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
                      {filteredSectionOptions.map(s => (
                        <button
                          key={s}
                          type="button"
                          onMouseDown={() => { updateField('section', s); setSectionMenuOpen(false); }}
                          className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-canvas"
                        >
                          {s}
                        </button>
                      ))}
                      {newPatient.section.trim() && !schoolSectionOptions.some(s => s.toLowerCase() === newPatient.section.trim().toLowerCase()) && (
                        <button
                          type="button"
                          onMouseDown={() => setSectionMenuOpen(false)}
                          className={`block w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary-surface ${filteredSectionOptions.length > 0 ? 'border-t border-border' : ''}`}
                        >
                          + Add "{newPatient.section.trim()}" as new section
                        </button>
                      )}
                      {filteredSectionOptions.length === 0 && !newPatient.section.trim() && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Type to search or add a section</p>
                      )}
                    </div>
                  )}
                  {fieldError('section')}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-foreground mb-1">Place of Birth{optionalTag}</label><input type="text" value={newPatient.placeOfBirth} onChange={e => setNewPatient({...newPatient, placeOfBirth: e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                <div><label className="block text-sm font-medium text-foreground mb-1">Contact Number{optionalTag} {ocrHint('contactNumber')}</label><input type="text" value={newPatient.contactNumber} onChange={e => updateField('contactNumber', e.target.value)} placeholder="09XX-XXX-XXXX" className={ocrFieldClass('contactNumber')} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-foreground mb-1">Guardian Name{optionalTag}</label><input type="text" value={newPatient.guardianName} onChange={e => setNewPatient({...newPatient, guardianName: e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
                <div><label className="block text-sm font-medium text-foreground mb-1">Guardian Contact{optionalTag}</label><input type="text" value={newPatient.guardianContact} onChange={e => setNewPatient({...newPatient, guardianContact: e.target.value})} placeholder="09XX-XXX-XXXX" className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              </div>
              <div><label className="block text-sm font-medium text-foreground mb-1">Occupation{optionalTag}</label><input type="text" value={newPatient.guardianOccupation} onChange={e => setNewPatient({...newPatient, guardianOccupation: e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-foreground mb-1">PhilHealth Number{optionalTag} {ocrHint('philhealthNumber')}</label><input type="text" value={newPatient.philhealthNumber} onChange={e => setNewPatient({...newPatient, philhealthNumber: e.target.value, ...(e.target.value.trim() === '' ? { philhealthStatus: 'None' } : {})})} placeholder="XX-XXXXXXXXX-X" className={ocrFieldClass('philhealthNumber')} /></div>
                {/* Only meaningful with a number (user, 2026-09-24): disabled and held at None until one is typed. */}
                <div><label className="block text-sm font-medium text-foreground mb-1">PhilHealth Status</label><select value={newPatient.philhealthNumber.trim() ? newPatient.philhealthStatus : 'None'} disabled={!newPatient.philhealthNumber.trim()} title={newPatient.philhealthNumber.trim() ? undefined : 'Enter a PhilHealth number first'} onChange={e => setNewPatient({...newPatient, philhealthStatus: e.target.value})} className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"><option value="None">None</option><option value="Principal">Principal</option><option value="Dependent">Dependent</option></select></div>
              </div>
              <div><label className="block text-sm font-medium text-foreground mb-1">Address{optionalTag} {ocrHint('address')}</label><input type="text" value={newPatient.address} onChange={e => updateField('address', e.target.value)} className={ocrFieldClass('address')} />{fieldError('address')}</div>
              <div className="flex items-center gap-3"><input type="checkbox" id="is4ps" checked={newPatient.is4Ps} onChange={e => setNewPatient({...newPatient, is4Ps: e.target.checked})} className="w-4 h-4 rounded accent-primary" /><label htmlFor="is4ps" className="text-sm font-medium text-foreground">4Ps / NHTS Member</label></div>
              {newPatient.is4Ps && <div><label className="block text-sm font-medium text-foreground mb-1">4Ps ID{req('fourPsId')} {ocrHint('fourPsId')}</label><input type="text" value={newPatient.fourPsId} onChange={e => updateField('fourPsId', e.target.value)} placeholder="4PS-XXXXXXXX" className={ocrFieldClass('fourPsId')} />{fieldError('fourPsId')}</div>}
              {/* Notice, not a bare <p>: it carries role="alert", so a screen
                  reader announces the validation failure instead of leaving the
                  user staring at an unchanged form. */}
              {addPatientError && <Notice variant="error">{addPatientError}</Notice>}
            </div>
            {/* sticky bottom-0, same reasoning as the header -- pins against
                the dialog's own scroll so Cancel/Add Student stay reachable
                without scrolling all the way down a long form. */}
            <div className="sticky bottom-0 z-10 flex gap-3 p-6 border-t bg-card">
              <button onClick={closeAddForm} className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>
              <button onClick={handleAddStudentClick} disabled={addingPatient} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">Add Student</button>
            </div>
        </Modal>
      )}

      {/* One step between "form looks valid" and actually saving — a typo'd
          click used to save immediately with no way back. */}
      <ConfirmDialog
        open={showAddConfirm}
        title={`Add ${newPatient.firstName} ${newPatient.lastName} as a new student?`}
        message="This creates a new student record and opens this school year's chart for them."
        confirmLabel="Add Student"
        tone="default"
        busy={addingPatient}
        onConfirm={() => handleAddStudent()}
        onCancel={() => setShowAddConfirm(false)}
      />

      {/* A deliberate second step before waving off a possible duplicate —
          matches the weight of the decision (a wrong call here means two
          records for one child). */}
      <ConfirmDialog
        open={showConfirmDifferentStudent}
        title="Are you sure this is a different student?"
        message={
          liveDuplicateMatches[0]
            ? `${liveDuplicateMatches[0].name} is already on file with the same name, birthday and sex. Only confirm if you're certain this is a separate child, not a duplicate entry.`
            : ''
        }
        confirmLabel="Yes, different student"
        tone="danger"
        onConfirm={() => {
          if (liveDuplicateMatches[0]) setAcknowledgedDuplicateId(liveDuplicateMatches[0].id);
          setShowConfirmDifferentStudent(false);
        }}
        onCancel={() => setShowConfirmDifferentStudent(false)}
      />

      {/* ── POSSIBLE DUPLICATE MODAL (Sprint 47) ──
          Shown when POST /students answers 409. Deliberately a decision, not a
          block: two children in one school genuinely sharing a name and a
          birthday is rare but real, so the encoder can always continue. */}
      {duplicateWarning && (
        <Modal onClose={() => setDuplicateWarning(null)} maxWidth="max-w-md" closeDisabled={addingPatient}>
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-foreground">Already on file?</h2>
              <button onClick={() => setDuplicateWarning(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                {duplicateWarning.length === 1 ? 'A student' : `${duplicateWarning.length} students`} with this name and birthday {duplicateWarning.length === 1 ? 'is' : 'are'} already recorded at this school. Open the existing record instead of adding a second one — unless this really is a different child.
              </p>
              <ul className="space-y-2">
                {duplicateWarning.map((d) => (
                  <li key={d._id} className="border border-border rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{d.full_name}</p>
                      <p className="text-xs text-muted-foreground">{d.grade_level} {d.section} · {d.sex} · {formatDate(d.birthday)}</p>
                    </div>
                    <button
                      onClick={() => { setDuplicateWarning(null); setShowAddForm(false); navigate(`/dental-chart/${d._id}?tab=history`); }}
                      className="px-3 py-1.5 border border-border rounded-lg hover:bg-gray-50 text-xs font-medium whitespace-nowrap"
                    >Open</button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 p-6 border-t">
              <button onClick={() => setDuplicateWarning(null)} className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">Back to form</button>
              <button onClick={() => handleAddStudent(true)} disabled={addingPatient} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 text-sm font-medium">{addingPatient ? 'Adding…' : 'Add anyway'}</button>
            </div>
        </Modal>
      )}

      {/* ── BULK UPLOAD MODAL ── */}
      {showBulkUpload && (
        <Modal onClose={resetBulkUpload} maxWidth="max-w-lg" closeDisabled={bulkImporting}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-foreground">Bulk Upload Students</h2>
              <button onClick={resetBulkUpload} disabled={bulkImporting} className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-40"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-4">
              {bulkStep === 'upload' && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                    <FileText className="w-3.5 h-3.5 inline mr-1" />
                    Upload a CSV or Excel (.xlsx) file. Required columns: <strong>Last Name, First Name, Sex, Grade Level, Section, Birthday</strong>. Optional: Middle Name, Address, Contact Number.
                  </div>
                  <div
                    className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('bulk-file-input')?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file) { setBulkFile(file); }
                    }}
                  >
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground font-medium">{bulkFile ? bulkFile.name : 'Drop CSV / Excel file here'}</p>
                    <p className="text-xs text-muted-foreground mt-1">{bulkFile ? `${(bulkFile.size / 1024).toFixed(1)} KB` : 'or click to browse'}</p>
                    <input id="bulk-file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) setBulkFile(e.target.files[0]); }} />
                  </div>
                  {bulkFile && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs font-medium text-muted-foreground mb-2">CSV Template (expected format):</div>
                      <div className="font-mono text-xs text-muted-foreground overflow-x-auto whitespace-nowrap">
                        last_name,first_name,middle_name,sex,grade_level,section,birthday,address,contact_number<br/>
                        Dela Cruz,Juan,Santos,Male,Grade 4,Sampaguita,2016-03-15,123 Tanyag St,09171234567<br/>
                        Santos,Maria,Reyes,Female,Grade 3,Jasmine,2017-07-22,45 Daang Hari Rd,09281234567
                      </div>
                    </div>
                  )}
                  {bulkParseError && <p className="text-sm text-destructive">{bulkParseError}</p>}
                  <div className="flex gap-3">
                    <button onClick={resetBulkUpload}
                      className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>
                    <button
                      disabled={!bulkFile}
                      onClick={handleParseBulk}
                      className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover text-sm font-medium disabled:opacity-40">
                      Parse File →
                    </button>
                  </div>
                </>
              )}

              {bulkStep === 'preview' && (
                <>
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                    <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                    <span className="text-sm text-green-800">
                      {bulkPreview.filter(r => !r.error).length} of {bulkPreview.length} rows ready from <strong>{bulkFile?.name}</strong>
                      {bulkPreview.some(r => r.error) && <> — {bulkPreview.filter(r => r.error).length} with issues will be skipped</>}
                    </span>
                  </div>
                  <div className="border border-border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-border">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Sex</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Grade</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Section</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Birthday</th>
                          <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Issue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bulkPreview.map((s, i) => (
                          <tr key={i} className={s.error ? 'bg-danger-surface' : 'hover:bg-gray-50'}>
                            <td className="px-3 py-2 font-medium text-foreground">{s.lastName || '—'}{s.lastName || s.firstName ? ', ' : ''}{s.firstName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.sex}</td>
                            <td className="px-3 py-2">
                              <GradePill grade={s.grade} />
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{s.section}</td>
                            <td className="px-3 py-2 text-muted-foreground tabular-nums">{s.birthday}</td>
                            <td className="px-3 py-2 text-destructive">{s.error ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700">
                    <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                    Students will be added to <strong>{selectedSchool ? getSchoolShortName(selectedSchool) : 'your current school'}</strong> with consent status = <strong>Pending</strong>. Rows with issues are skipped.
                  </div>
                  {bulkParseError && <p className="text-sm text-destructive">{bulkParseError}</p>}
                  <div className="flex gap-3">
                    <button onClick={() => setBulkStep('upload')} disabled={bulkImporting}
                      className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-40">← Back</button>
                    <button onClick={handleBulkImport}
                      disabled={bulkImporting || bulkPreview.filter(r => !r.error).length === 0}
                      className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover text-sm font-medium disabled:opacity-40">
                      {bulkImporting
                        ? `Importing… (${bulkProgress}/${bulkPreview.filter(r => !r.error).length})`
                        : `Import ${bulkPreview.filter(r => !r.error).length} Students`}
                    </button>
                  </div>
                </>
              )}

              {bulkStep === 'done' && (
                <div className="text-center py-8">
                  <div className={`w-16 h-16 ${bulkResult.imported > 0 ? 'bg-green-100' : 'bg-danger-surface'} rounded-full flex items-center justify-center mx-auto mb-4`}>
                    {bulkResult.imported > 0
                      ? <CheckCircle className="w-8 h-8 text-success" />
                      : <AlertCircle className="w-8 h-8 text-destructive" />}
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-1">
                    {bulkResult.imported} Student{bulkResult.imported !== 1 ? 's' : ''} Imported
                  </h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {bulkResult.imported > 0 ? 'Added with pending consent status.' : 'Nothing was imported.'}
                  </p>
                  {bulkResult.failures.length > 0 && (
                    <div className="text-left bg-danger-surface rounded-lg p-3 mb-4 max-h-32 overflow-y-auto">
                      <p className="text-xs font-semibold text-destructive mb-1">{bulkResult.failures.length} row{bulkResult.failures.length !== 1 ? 's' : ''} failed:</p>
                      {bulkResult.failures.slice(0, 5).map((f, i) => (
                        <p key={i} className="text-xs text-destructive">{f.name} — {f.error}</p>
                      ))}
                      {bulkResult.failures.length > 5 && <p className="text-xs text-destructive">…and {bulkResult.failures.length - 5} more</p>}
                    </div>
                  )}
                  <button onClick={resetBulkUpload}
                    className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover text-sm font-medium">
                    Done
                  </button>
                </div>
              )}
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={dequeueTarget !== null}
        title={`Remove ${dequeueTarget?.name ?? 'this student'} from the charting queue?`}
        message="They'll need to be queued again to come back to this list."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => {
          if (dequeueTarget) setQueuedStudentIds(removeQueuedStudentId(dequeueTarget.id));
          setDequeueTarget(null);
        }}
        onCancel={() => setDequeueTarget(null)}
      />

      <ConfirmDialog
        open={confirmArchiveTicked}
        title={`Archive ${tickedIds.size} student${tickedIds.size === 1 ? '' : 's'}?`}
        message={
          <div className="space-y-3">
            <p>Archived students are removed from active rosters and reports. A System Admin can restore them later from Archived Records.</p>
            {/* Isolated <form> on purpose — this was pairing with the page's
                Search box as a "username" field once a saved-credential
                suggestion was picked (browsers/password managers look for the
                nearest preceding text input to pair with a password field,
                and outside a form boundary that search for a pairing widened
                to the whole page). Its own <form>, containing no other
                input, gives the pairing heuristic nothing else to find. */}
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor={archivePasswordFieldName} className="block text-xs font-medium text-foreground mb-1">Enter your password to confirm</label>
              <input
                id={archivePasswordFieldName}
                name={archivePasswordFieldName}
                type="password"
                required
                // Neither "current-password" (invites autofill with the saved
                // login password) nor "new-password" (invites Chrome's "suggest
                // a strong password" prompt, since it reads that as account
                // creation) fits a re-type-to-confirm field. "one-time-code"
                // isn't a password-persistence hint at all, so it invites
                // neither. The data-*-ignore attributes are the non-standard
                // but widely honored way to tell LastPass/1Password/Bitwarden
                // to leave this field alone too.
                autoComplete="one-time-code"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                autoFocus
                value={archivePassword}
                onChange={(e) => { setArchivePassword(e.target.value); setArchivePasswordError(null); }}
                disabled={archivingTicked}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              {archivePasswordError && <p className="mt-1 text-xs text-destructive">{archivePasswordError}</p>}
            </form>
          </div>
        }
        confirmLabel="Archive"
        tone="danger"
        busy={archivingTicked}
        onConfirm={archiveTicked}
        onCancel={() => { setConfirmArchiveTicked(false); setArchivePassword(''); setArchivePasswordError(null); }}
      />
    </div>
  );
};

