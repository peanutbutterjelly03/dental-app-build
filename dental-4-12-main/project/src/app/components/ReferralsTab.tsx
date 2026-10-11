import { Plus } from 'lucide-react';
import { formatDate } from '../utils/localDate';
import type { ApiReferral, ReferralType } from '../api/types';

// The Referrals tab (Sprint 127) — issue-only by design: a referral is recorded
// when it is written, and nothing here pretends to know whether the family went.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged.

// Sprint 127 — the referral kinds are the DOH Oral Health Program Report's own
// printed rows, not a taxonomy of ours. Picking one here IS the report row the
// patient will be counted in, so the labels say so rather than paraphrasing.
//
// ⚠ A SECOND COPY OF THIS MAP LIVES IN `Reports.tsx`, AND THE TWO HAVE ALREADY
// DRIFTED — three of the five labels differ (BUG-14, found 2026-09-14). Both
// claim to be the form's own wording and they cannot both be right. **Moved
// here verbatim on purpose: reconciling them needs the actual DOH form, which
// is a form-fidelity decision, not a refactor.** Do not quietly align one to
// the other.
export const REFERRAL_TYPE_LABELS: Record<ReferralType, string> = {
  primary_care: 'Other Primary Care Facility',
  higher_level: 'Higher Level of Care (unspecified)',
  oral_cancer_screening: 'Higher Level — Oral Cancer Screening',
  surgical: 'Higher Level — Surgical Procedure',
  private_facility: 'Higher Level — Private Facility',
};

export interface ReferralAddForm {
  open: boolean;
  setOpen: (open: boolean) => void;
  values: { date: string; referralType: ReferralType; facility: string; followUp: string; reason: string; notes: string };
  setValues: React.Dispatch<React.SetStateAction<{ date: string; referralType: ReferralType; facility: string; followUp: string; reason: string; notes: string }>>;
  error: string | null;
  saving: boolean;
  onSave: () => void;
}

export function ReferralsTab({
  referrals,
  schoolYear,
  canEdit,
  addForm,
}: {
  referrals: ApiReferral[];
  schoolYear: string | undefined;
  canEdit: boolean;
  addForm: ReferralAddForm;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-bold text-foreground">Referrals</h3>
        {canEdit && schoolYear && (
          <button onClick={() => addForm.setOpen(!addForm.open)} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover">
            <Plus className="w-3.5 h-3.5" /> Record Referral
          </button>
        )}
      </div>
      {addForm.open && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <p className="text-xs text-blue-700">Adding to school year: <strong>{schoolYear}</strong></p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-foreground mb-1">Date Issued *</label>
              <input type="date" value={addForm.values.date} onChange={(e) => addForm.setValues((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg" /></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">Referred For</label>
              <select value={addForm.values.referralType} onChange={(e) => addForm.setValues((f) => ({ ...f, referralType: e.target.value as ReferralType }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-card">
                {(Object.keys(REFERRAL_TYPE_LABELS) as ReferralType[]).map((t) => (
                  <option key={t} value={t}>{REFERRAL_TYPE_LABELS[t]}</option>
                ))}
              </select>
              {/* Stated on screen because the choice is not cosmetic: it decides
                  which row of a form filed with the City Health Office this
                  patient is counted in. */}
              <p className="text-[11px] text-muted-foreground mt-1">Decides which row of the DOH Program Report this patient is counted in.</p></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">Referred To (facility) *</label>
              <input type="text" maxLength={120} value={addForm.values.facility} onChange={(e) => addForm.setValues((f) => ({ ...f, facility: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg" /></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">Expected Follow-up</label>
              <input type="date" value={addForm.values.followUp} onChange={(e) => addForm.setValues((f) => ({ ...f, followUp: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg" /></div>
            <div className="md:col-span-2"><label className="block text-xs font-medium text-foreground mb-1">Reason *</label>
              <textarea rows={2} maxLength={500} value={addForm.values.reason} onChange={(e) => addForm.setValues((f) => ({ ...f, reason: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg" /></div>
            <div className="md:col-span-2"><label className="block text-xs font-medium text-foreground mb-1">Notes</label>
              <input type="text" maxLength={500} value={addForm.values.notes} onChange={(e) => addForm.setValues((f) => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg" /></div>
          </div>
          {addForm.error && <p className="text-xs text-destructive">{addForm.error}</p>}
          <div className="flex gap-2">
            <button onClick={addForm.onSave} disabled={addForm.saving} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50">{addForm.saving ? 'Saving…' : 'Save Referral'}</button>
            <button onClick={() => addForm.setOpen(false)} className="px-4 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
      {referrals.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">No referrals recorded yet.</p>
      ) : (
      <>
      <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>{['Date Issued', 'Referred For', 'Facility', 'Reason', 'Follow-up'].map((h) => (
              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-card">
            {referrals.map((r) => (
              <tr key={r._id} className="hover:bg-gray-50">
                <td className="px-4 py-2 whitespace-nowrap font-medium text-foreground text-xs">{formatDate(r.date_issued)}</td>
                <td className="px-4 py-2 text-xs text-foreground">{REFERRAL_TYPE_LABELS[r.referral_type]}</td>
                <td className="px-4 py-2 text-xs text-foreground">{r.facility_name}</td>
                <td className="px-4 py-2 text-xs text-foreground">{r.reason}</td>
                <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{r.follow_up_date ? formatDate(r.follow_up_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-3">
        {referrals.map((r) => (
          <div key={r._id} className="rounded-lg border bg-card border-border p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground text-xs">{formatDate(r.date_issued)}</span>
              <span className="text-xs text-muted-foreground text-right">{REFERRAL_TYPE_LABELS[r.referral_type]}</span>
            </div>
            <p className="text-xs text-muted-foreground"><span className="font-medium">To:</span> {r.facility_name}</p>
            <p className="text-xs text-muted-foreground"><span className="font-medium">Reason:</span> {r.reason}</p>
            {r.follow_up_date && <p className="text-xs text-muted-foreground"><span className="font-medium">Follow-up:</span> {formatDate(r.follow_up_date)}</p>}
            {r.notes && <p className="text-xs text-muted-foreground italic">{r.notes}</p>}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
