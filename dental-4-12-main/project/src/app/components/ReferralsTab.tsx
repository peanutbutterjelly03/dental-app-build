import { useState } from 'react';
import { Plus } from 'lucide-react';
import { formatDate } from '../utils/localDate';
import type { ApiReferral, ReferralType } from '../api/types';
import type { IptrYearData } from '../hooks/useDentalChartData';

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

const KIND_TONE: Record<ReferralType, string> = {
  primary_care: 'border-teal-300 bg-teal-100 text-teal-800',
  higher_level: 'border-primary-surface bg-primary-surface text-primary',
  oral_cancer_screening: 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800',
  surgical: 'border-amber-300 bg-amber-100 text-amber-800',
  private_facility: 'border-sky-300 bg-sky-100 text-sky-800',
};
const KindChip = ({ type }: { type: ReferralType }) => (
  <span className={`inline-block max-w-full rounded-full border px-2.5 py-0.5 text-[11px] font-bold leading-snug ${KIND_TONE[type]}`}>{REFERRAL_TYPE_LABELS[type]}</span>
);
const dayStart = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
/** Whole days from today to the follow-up date; negative once it has passed. */
const daysUntil = (iso: string) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((dayStart(iso).getTime() - t.getTime()) / 86400000);
};
// ⚠ Issue-only: nothing records whether the family went, so a date in the past is
// "date passed", never "overdue" or "missed".
const FollowUp = ({ iso }: { iso: string | null }) => {
  if (!iso) return <span className="inline-flex rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-semibold">No follow-up date</span>;
  const n = daysUntil(iso);
  const tone = n < 0 ? 'border-red-300 bg-red-100 text-red-700' : n <= 14 ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-border bg-muted/40 text-foreground';
  const text = n < 0 ? `Follow-up date passed ${-n} day${n === -1 ? '' : 's'} ago, ${formatDate(iso)}` : n === 0 ? 'Follow-up today' : `Follow-up in ${n} day${n === 1 ? '' : 's'}, ${formatDate(iso)}`;
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>;
};

export function ReferralsTab({
  referrals,
  years,
  dentistNameById,
  schoolYear,
  canEdit,
  addForm,
}: {
  referrals: ApiReferral[];
  years: IptrYearData[];
  dentistNameById: Map<string, string>;
  schoolYear: string | undefined;
  canEdit: boolean;
  addForm: ReferralAddForm;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const yearOfIptr = new Map(years.map((y) => [y.iptr._id, y.iptr.school_year]));
  const selected = referrals.find((r) => r._id === selId) ?? referrals[0] ?? null;
  const thisYear = referrals.filter((r) => yearOfIptr.get(r.iptr_id) === schoolYear).length;
  const coming = referrals.filter((r) => r.follow_up_date && daysUntil(r.follow_up_date) >= 0).length;
  const passed = referrals.filter((r) => r.follow_up_date && daysUntil(r.follow_up_date) < 0).length;
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
      {referrals.length === 0 || !selected ? (
        <div className="space-y-1.5 rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <div className="text-sm font-bold">No referrals recorded yet</div>
          <p className="mx-auto max-w-prose text-xs text-muted-foreground">When the child is sent to another facility, record it here. It also counts the child in the matching row of the DOH Oral Health Program Report.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Referrals this school year</div><div className="text-2xl font-extrabold tabular-nums">{thisYear}</div><div className="text-xs text-muted-foreground">all years: {referrals.length}</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Follow-ups coming</div><div className="text-2xl font-extrabold tabular-nums">{coming}</div><div className="text-xs text-muted-foreground">date not yet reached</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Follow-up dates passed</div><div className={`text-2xl font-extrabold tabular-nums ${passed ? 'text-red-600' : ''}`}>{passed}</div><div className="text-xs text-muted-foreground">nothing records the outcome</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Last referral</div><div className="text-base font-extrabold">{formatDate(referrals[0].date_issued)}</div><div className="text-xs text-muted-foreground">{REFERRAL_TYPE_LABELS[referrals[0].referral_type]}</div></div>
          </div>
          <div className="grid items-start gap-3.5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div className="grid min-w-0 gap-2">
              {referrals.map((r) => (
                <button key={r._id} type="button" onClick={() => setSelId(r._id)} aria-pressed={selected._id === r._id}
                  className={`grid gap-1 rounded-xl border bg-card p-3 text-left ${selected._id === r._id ? 'border-primary ring-2 ring-primary-surface' : 'border-border hover:bg-muted/40'}`}>
                  <b className="text-[13px]">{formatDate(r.date_issued)}</b>
                  <span className="truncate text-xs text-muted-foreground">{r.facility_name}</span>
                  <KindChip type={r.referral_type} />
                </button>
              ))}
            </div>
            <div className="min-w-0 space-y-2.5 rounded-xl border border-border bg-card p-4">
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Referral of {formatDate(selected.date_issued)}</div>
                <div className="text-base font-extrabold">{selected.facility_name}</div>
              </div>
              <KindChip type={selected.referral_type} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Reason</div><p className="text-[13px]">{selected.reason}</p></div>
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Notes</div>{selected.notes ? <p className="text-[13px]">{selected.notes}</p> : <p className="text-xs text-muted-foreground">None</p>}</div>
              </div>
              <FollowUp iso={selected.follow_up_date} />
              <p className="text-xs text-muted-foreground">Counted in the DOH Program Report under: <b className="text-foreground">{REFERRAL_TYPE_LABELS[selected.referral_type]}</b></p>
              <p className="text-xs text-muted-foreground">
                {selected.dentist_id ? `Recorded by ${dentistNameById.get(selected.dentist_id) ?? 'a dentist'}` : 'Recorded by clinic staff'}
                {yearOfIptr.get(selected.iptr_id) ? `, school year ${yearOfIptr.get(selected.iptr_id)}` : ''}.
              </p>
            </div>
          </div>
        </>
      )}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">Reasons and notes are private patient information. Only staff with access to this record can see them.</p>
    </div>
  );
}
