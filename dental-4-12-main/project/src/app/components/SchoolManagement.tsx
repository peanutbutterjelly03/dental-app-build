import { useState } from 'react';
import { Plus, Edit, Archive, X as XIcon, School as SchoolIcon } from 'lucide-react';
import { useSchools } from '../hooks/useSchools';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool, ApiUser } from '../api/types';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { PageHeader } from './PageHeader';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { getSchoolShortName } from '../utils/schoolColors';
import { SCHOOL_GRADES, schoolGradeLabel, schoolGradeRange } from '../utils/schoolGrades';

// ─── School registry (System Admin) ──────────────────────────────────────────
// The three schools existed only in a seeder and in five hardcoded arrays
// across the UI. Admin could assign staff to a school but could not add one,
// and a school created through the API appeared in no form.
//
// The form asks only for what the app uses: name, nickname, grade range,
// barangay and an optional address. City is fixed to Taguig City, the only city
// the system covers. School type and principal were dropped (2026-09-30).
//
// Archive, not delete: School carries the standard soft-delete fields and
// crudFactory locks both archive and restore to System Admin. Nothing is ever
// removed, so a school with historical records keeps them.

const emptyForm = {
  school_name: '',
  school_nickname: '',
  grade_from: 'Kinder',
  grade_to: 'Grade 6',
  street_address: '',
  barangay: 'Tanyag',
  // Fixed: Taguig City is the only city the system covers.
  city: 'Taguig City',
  allow_school_year_override: false,
};

// The dentist and the dental aide assigned to a school are chosen in the form
// but stored on the USER (`school_ids`), the list that decides which schools an
// account can open. They are not fields of the school.
const emptyStaff = { dentist_id: '', aide_id: '' };

export const SchoolManagement = () => {
  const { schools, loading, error, reload } = useSchools();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ApiSchool | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [staff, setStaff] = useState({ ...emptyStaff });
  // Staff assigned when the form opened, to tell what changed on save.
  const [staffAtOpen, setStaffAtOpen] = useState({ ...emptyStaff });
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<ApiSchool | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Fresh list every time the form opens, so a just-created account appears.
  const loadUsers = async () => {
    try {
      const list = await apiClient.get<ApiUser[]>('/users');
      setUsers(list);
      return list;
    } catch {
      setUsers([]);
      return [] as ApiUser[];
    }
  };

  const openCreate = async () => {
    await loadUsers();
    setEditing(null);
    setForm({ ...emptyForm });
    setStaff({ ...emptyStaff });
    setStaffAtOpen({ ...emptyStaff });
    setFormError(null);
    setShowForm(true);
  };

  // An account with an EMPTY school list covers every school, so it is never
  // read as "assigned here" and is never edited from this form.
  const assignedTo = (list: ApiUser[], role: string, schoolId: string) =>
    list.find((u) => u.role === role && u.school_ids.length > 0 && u.school_ids.includes(schoolId))?._id ?? '';

  const openEdit = async (s: ApiSchool) => {
    const list = await loadUsers();
    const current = { dentist_id: assignedTo(list, 'dentist', s._id), aide_id: assignedTo(list, 'dental_aide', s._id) };
    setStaff(current);
    setStaffAtOpen(current);
    setEditing(s);
    setForm({
      school_name: s.school_name ?? '',
      school_nickname: s.school_nickname ?? '',
      grade_from: schoolGradeRange(s).from || emptyForm.grade_from,
      grade_to: schoolGradeRange(s).to || emptyForm.grade_to,
      street_address: s.street_address ?? '',
      barangay: s.barangay ?? '',
      city: emptyForm.city,
      allow_school_year_override: s.allow_school_year_override ?? false,
    });
    setFormError(null);
    setShowForm(true);
  };

  const submit = async () => {
    setFormError(null);
    // Named explicitly rather than "fill in all required fields" — the blanket
    // message leaves the user hunting for which box is empty.
    const missing = (Object.entries({
      'School name': form.school_name,
      Barangay: form.barangay,
    }) as [string, string][]).filter(([, v]) => !v.trim()).map(([k]) => k);
    if (missing.length) {
      setFormError(`Please fill in: ${missing.join(', ')}.`);
      return;
    }
    if (SCHOOL_GRADES.indexOf(form.grade_from) > SCHOOL_GRADES.indexOf(form.grade_to)) {
      setFormError('Grades From must come before Grades To.');
      return;
    }
    // Swapping staff removes the school from the previous person's list. If it
    // was their only school that would leave the list EMPTY, which the system
    // reads as "every school", so refuse before anything is saved.
    const roleChanges = ([
      ['dentist_id', 'Dentist'],
      ['aide_id', 'Dental Aide'],
    ] as const).filter(([key]) => staff[key] !== staffAtOpen[key]);
    for (const [key, roleLabel] of roleChanges) {
      const prev = users.find((u) => u._id === staffAtOpen[key]);
      if (prev && prev.school_ids.filter((id) => id !== editing?._id).length === 0) {
        setFormError(`${prev.full_name} has no other school. Removing this one would give them access to every school. Assign them another school in User Management first, or keep them as the ${roleLabel}.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      let schoolId = editing?._id ?? '';
      if (editing) {
        await apiClient.put(`/schools/${editing._id}`, form);
      } else {
        const created = await apiClient.post<ApiSchool>('/schools', form);
        schoolId = created._id;
      }
      // Assignment lives on the USER (school_ids). Accounts with an empty list
      // already cover every school and are left as they are.
      for (const [key] of roleChanges) {
        const prev = users.find((u) => u._id === staffAtOpen[key]);
        const next = users.find((u) => u._id === staff[key]);
        if (prev) {
          await apiClient.put(`/users/${prev._id}`, { school_ids: prev.school_ids.filter((id) => id !== schoolId) });
        }
        if (next && next.school_ids.length > 0 && !next.school_ids.includes(schoolId)) {
          await apiClient.put(`/users/${next._id}`, { school_ids: [...next.school_ids, schoolId] });
        }
      }
      toast.success(editing ? `${form.school_name} updated.` : `${form.school_name} added.`);
      await reload();
      setShowForm(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save school');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async () => {
    if (!confirmArchive) return;
    setArchiving(true);
    try {
      await apiClient.patch(`/schools/${confirmArchive._id}/archive`);
      toast.success(`${confirmArchive.school_name} archived.`);
      await reload();
      setConfirmArchive(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to archive school');
    } finally {
      setArchiving(false);
    }
  };

  if (loading) return <><SkeletonPageHeader /><SkeletonTable rows={4} /></>;

  const field = 'w-full px-4 py-3 text-sm text-[#475569] bg-[#F8FAFC] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#16214F]/30';
  const fieldStyle = { border: '1px solid #E2E8F0' } as const;
  const label = 'block text-sm font-bold text-foreground mb-1.5';

  // Elementary = the school stops at Grade 6 or earlier; Integrated = it goes past Grade 6.
  const topGrade = (sc: ApiSchool) => SCHOOL_GRADES.indexOf(schoolGradeRange(sc).to);
  const stats = [
    { label: 'Total Schools', value: schools.length, bg: '#E8ECF6', fg: '#273A78' },
    { label: 'Elementary', value: schools.filter((sc) => topGrade(sc) >= 0 && topGrade(sc) <= 6).length, bg: '#ECFDF5', fg: '#047857' },
    { label: 'Integrated', value: schools.filter((sc) => topGrade(sc) > 6).length, bg: '#FFFBEB', fg: '#B45309' },
  ];
  const th = 'px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider';
  const td = 'px-6 py-4 text-sm text-foreground';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SchoolIcon}
        eyebrow="Administration"
        title="Schools"
        description="Manage the schools. Every school dropdown in the app reads this list."
        action={
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            <Plus className="w-4 h-4" /> Add School
          </button>
        }
      />

      {error && <Notice variant="error">{error}</Notice>}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map(({ label, value, bg, fg }) => (
          <div key={label} className="flex items-start justify-between gap-3 min-h-[8.5rem] rounded-2xl border border-border bg-card p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
            <div className="min-w-0 self-stretch flex flex-col justify-between">
              <div className="text-sm font-bold uppercase tracking-wider text-foreground">{label}</div>
              <div className="text-4xl font-bold text-foreground mt-3 leading-none">{value}</div>
            </div>
            <span style={{ backgroundColor: bg, color: fg }} className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center">
              <SchoolIcon className="w-4 h-4" />
            </span>
          </div>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] flex-shrink-0"><SchoolIcon className="w-5 h-5" /></span>
            <div>
              <div className="text-xl font-bold text-foreground">System Schools</div>
              <div className="text-sm text-muted-foreground">Review and manage registered schools.</div>
            </div>
          </div>
          <span className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-bold text-[#64748B] whitespace-nowrap">{schools.length} {schools.length === 1 ? 'school' : 'schools'} found</span>
        </div>
        {schools.length === 0 ? (
          <div className="border-t border-border flex flex-col items-center justify-center text-center px-6 py-20">
            <span className="w-[4.5rem] h-[4.5rem] rounded-2xl grid place-items-center bg-[#F1F5F9] text-[#94A3B8]"><SchoolIcon className="w-8 h-8" /></span>
            <div className="mt-5 text-base font-bold text-foreground">No schools yet</div>
            <div className="mt-2 text-xs text-muted-foreground">Add one. Student, appointment and report forms all read this list.</div>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full border-collapse">
              <thead className="bg-gray-50 border-b border-border">
                <tr>
                  <th className={th}>School</th>
                  <th className={th}>Grades</th>
                  <th className={th}>Address</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {schools.map((s) => (
                  <tr key={s._id} className="hover:bg-gray-50">
                    <td className={`${td} whitespace-nowrap`}>
                      <div className="flex items-center gap-4">
                        <span className="w-11 h-11 flex-shrink-0 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] text-sm font-bold">{s.school_name.trim().charAt(0).toUpperCase()}</span>
                        <div className="min-w-0">
                          <div className="text-base font-bold text-foreground">{s.school_name}</div>
                          <div className="text-sm text-muted-foreground">{s.school_nickname || getSchoolShortName(s.school_name)}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {schoolGradeLabel(s) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#DCE3F5] bg-[#F4F7FF] text-xs font-bold text-[#273A78]">{schoolGradeLabel(s)}</span>
                      )}
                    </td>
                    <td className={`${td} text-xs text-muted-foreground`}>{[s.street_address, s.barangay, s.city].filter(Boolean).join(', ')}</td>
                    <td className={`${td} text-right whitespace-nowrap`}>
                      <button
                        onClick={() => openEdit(s)}
                        className="px-2 py-1 text-primary hover:text-[#1E3A8A]"
                        aria-label={`Edit ${s.school_name}`}
                      ><Edit className="w-4 h-4" /></button>
                      <button
                        onClick={() => setConfirmArchive(s)}
                        className="px-2 py-1 text-muted-foreground hover:text-destructive"
                        aria-label={`Archive ${s.school_name}`}
                      ><Archive className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <Modal onClose={() => setShowForm(false)} maxWidth="max-w-xl" rounded="rounded-2xl" closeDisabled={submitting}>
          <div className="overflow-hidden rounded-2xl">
            <div className="flex items-center gap-4 bg-[#F4F7FF] px-7 py-6 border-b border-border">
              <span className="w-12 h-12 flex-shrink-0 rounded-xl grid place-items-center bg-white text-[#273A78]"><SchoolIcon className="w-5 h-5" /></span>
              <div>
                <h2 className="text-xl font-bold text-foreground">{editing ? 'Edit School' : 'Add School'}</h2>
                <div className="text-sm text-muted-foreground">Every school dropdown in the app reads this list.</div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="ml-auto w-11 h-11 flex-shrink-0 grid place-items-center rounded-xl border border-[#E2E8F0] bg-white text-[#475569] hover:bg-gray-50 disabled:opacity-60"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-7 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sm-name">School Name *</label>
                  <input id="sm-name" className={field} style={fieldStyle} value={form.school_name}
                    onChange={(e) => setForm({ ...form, school_name: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sm-nick">School Nickname</label>
                  <input id="sm-nick" className={field} style={fieldStyle} value={form.school_nickname}
                    placeholder="e.g. BTIS, Southdaanghari"
                    onChange={(e) => setForm({ ...form, school_nickname: e.target.value })} />
                </div>
                <div>
                  <label className={label} htmlFor="sm-from">Grades From *</label>
                  <select id="sm-from" className={field} style={fieldStyle} value={form.grade_from}
                    onChange={(e) => setForm({ ...form, grade_from: e.target.value })}>
                    {SCHOOL_GRADES.map((g) => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="sm-to">Grades To *</label>
                  <select id="sm-to" className={field} style={fieldStyle} value={form.grade_to}
                    onChange={(e) => setForm({ ...form, grade_to: e.target.value })}>
                    {SCHOOL_GRADES.map((g) => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="sm-brgy">Barangay *</label>
                  <input id="sm-brgy" className={field} style={fieldStyle} value={form.barangay}
                    onChange={(e) => setForm({ ...form, barangay: e.target.value })} />
                </div>
                <div>
                  <label className={label} htmlFor="sm-city">City</label>
                  <input id="sm-city" className={`${field} cursor-not-allowed opacity-60`} style={fieldStyle} value={form.city} disabled readOnly />
                </div>
                <div>
                  <label className={label} htmlFor="sm-dentist">Assign Dentist</label>
                  <select id="sm-dentist" className={field} style={fieldStyle} value={staff.dentist_id}
                    onChange={(e) => setStaff({ ...staff, dentist_id: e.target.value })}>
                    <option value="">Not assigned</option>
                    {users.filter((u) => u.role === 'dentist').map((u) => (
                      <option key={u._id} value={u._id}>{u.full_name}{u.school_ids.length === 0 ? ' (all schools)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label} htmlFor="sm-aide">Assign Dental Aide</label>
                  <select id="sm-aide" className={field} style={fieldStyle} value={staff.aide_id}
                    onChange={(e) => setStaff({ ...staff, aide_id: e.target.value })}>
                    <option value="">Not assigned</option>
                    {users.filter((u) => u.role === 'dental_aide').map((u) => (
                      <option key={u._id} value={u._id}>{u.full_name}{u.school_ids.length === 0 ? ' (all schools)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="sm-street">School Address <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <input id="sm-street" className={field} style={fieldStyle} value={form.street_address}
                    onChange={(e) => setForm({ ...form, street_address: e.target.value })} />
                </div>
              </div>
              {/* ⚠ The "Allow school-year rollover anytime" toggle is GONE
                  (Sprint 187). Sprint 185 removed the March–August window it
                  governed, so it gated nothing. `allow_school_year_override`
                  stays on the SCHOOL model, unread. */}
              {formError && <Notice variant="error">{formError}</Notice>}
            </div>
            <div className="flex justify-end gap-2.5 border-t border-border px-7 py-5">
              <button onClick={() => setShowForm(false)} disabled={submitting}
                className="rounded-xl border border-[#CBD5E1] px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-gray-50 disabled:opacity-60">
                Cancel
              </button>
              <button onClick={submit} disabled={submitting}
                className="rounded-xl bg-[#273A78] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add School'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmArchive && (
        <ConfirmDialog
          open
          title={`Archive ${confirmArchive.school_name}?`}
          message="It disappears from every school dropdown. Records already filed against it are kept — nothing is deleted — and a System Admin can restore it."
          confirmLabel={archiving ? 'Archiving…' : 'Archive'}
          onConfirm={archive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}
    </div>
  );
};
