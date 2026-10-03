import { useState } from 'react';
import { Plus, Edit, Archive, School as SchoolIcon } from 'lucide-react';
import { useSchools } from '../hooks/useSchools';
import { apiClient, ApiError } from '../api/client';
import type { ApiSchool } from '../api/types';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { getSchoolShortName } from '../utils/schoolColors';

// ─── School registry (System Admin) ──────────────────────────────────────────
// The three schools existed only in a seeder and in five hardcoded arrays
// across the UI. Admin could assign staff to a school but could not add one,
// and a school created through the API appeared in no form.
//
// Every field here is required by the STUDENT-facing School model, so the form
// asks for all of them rather than writing blanks — see CLAUDE.md's rule about
// placeholders.
//
// Archive, not delete: School carries the standard soft-delete fields and
// crudFactory locks both archive and restore to System Admin. Nothing is ever
// removed, so a school with historical records keeps them.

const SCHOOL_TYPES = ['Integrated School', 'Elementary School', 'High School'];

const emptyForm = {
  school_name: '',
  school_type: SCHOOL_TYPES[0],
  principal_name: '',
  street_address: '',
  barangay: 'Tanyag',
  city: 'Taguig City',
  allow_school_year_override: false,
};

export const SchoolManagement = () => {
  const { schools, loading, error, reload } = useSchools();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ApiSchool | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<ApiSchool | null>(null);
  const [archiving, setArchiving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (s: ApiSchool) => {
    setEditing(s);
    setForm({
      school_name: s.school_name ?? '',
      school_type: s.school_type ?? SCHOOL_TYPES[0],
      principal_name: s.principal_name ?? '',
      street_address: s.street_address ?? '',
      barangay: s.barangay ?? '',
      city: s.city ?? '',
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
      'School type': form.school_type,
      'Principal name': form.principal_name,
      'Street address': form.street_address,
      Barangay: form.barangay,
      City: form.city,
    }) as [string, string][]).filter(([, v]) => !v.trim()).map(([k]) => k);
    if (missing.length) {
      setFormError(`Please fill in: ${missing.join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiClient.put(`/schools/${editing._id}`, form);
        toast.success(`${form.school_name} updated.`);
      } else {
        await apiClient.post('/schools', form);
        toast.success(`${form.school_name} added.`);
      }
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

  const th = 'px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground';
  const td = 'px-4 py-3 text-sm text-foreground';
  const field = 'w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-4">
      {/* Stacks below sm: per the three-device rule. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Schools</h1>
          <p className="text-xs text-muted-foreground">
            {schools.length} school{schools.length === 1 ? '' : 's'} · every school dropdown in the app reads this list
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add School
        </button>
      </div>

      {error && <Notice variant="error">{error}</Notice>}

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className={th}>School</th>
              <th className={th}>Type</th>
              <th className={th}>Principal</th>
              <th className={th}>Address</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {schools.length === 0 ? (
              <tr>
                <td className={`${td} text-center text-muted-foreground py-10`} colSpan={5}>
                  <SchoolIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No schools yet. Add one — student, appointment and report forms all read this list.
                </td>
              </tr>
            ) : schools.map((s) => (
              <tr key={s._id} className="hover:bg-gray-50">
                <td className={`${td} font-medium`}>
                  {s.school_name}
                  <span className="block text-xs text-muted-foreground">{getSchoolShortName(s.school_name)}</span>
                </td>
                <td className={td}>{s.school_type}</td>
                <td className={td}>{s.principal_name}</td>
                <td className={td}>{[s.street_address, s.barangay, s.city].filter(Boolean).join(', ')}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  <button
                    onClick={() => openEdit(s)}
                    className="px-2 py-1 text-muted-foreground hover:text-foreground"
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

      {showForm && (
        <Modal onClose={() => setShowForm(false)} closeDisabled={submitting}>
          <div className="p-6 space-y-4 max-w-lg">
            <h2 className="text-base font-bold text-foreground">{editing ? 'Edit School' : 'Add School'}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-name">School Name *</label>
                <input id="sm-name" className={field} value={form.school_name}
                  onChange={(e) => setForm({ ...form, school_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-type">School Type *</label>
                <select id="sm-type" className={field} value={form.school_type}
                  onChange={(e) => setForm({ ...form, school_type: e.target.value })}>
                  {SCHOOL_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-principal">Principal Name *</label>
                <input id="sm-principal" className={field} value={form.principal_name}
                  onChange={(e) => setForm({ ...form, principal_name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-street">Street Address *</label>
                <input id="sm-street" className={field} value={form.street_address}
                  onChange={(e) => setForm({ ...form, street_address: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-brgy">Barangay *</label>
                <input id="sm-brgy" className={field} value={form.barangay}
                  onChange={(e) => setForm({ ...form, barangay: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1" htmlFor="sm-city">City *</label>
                <input id="sm-city" className={field} value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            {editing && (
              <label className="flex items-start gap-2 text-sm text-foreground bg-gray-50 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={form.allow_school_year_override}
                  onChange={(e) => setForm({ ...form, allow_school_year_override: e.target.checked })}
                  className="w-4 h-4 mt-0.5 accent-primary"
                />
                <span>
                  Allow school-year rollover anytime
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    "Start New School Year" on Update School Year is normally only clickable March–August. Checking this lets the dentist/dental aide run it for this school outside that window.
                  </span>
                </span>
              </label>
            )}
            {formError && <Notice variant="error">{formError}</Notice>}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowForm(false)} disabled={submitting}
                className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submit} disabled={submitting}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Add School'}
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
