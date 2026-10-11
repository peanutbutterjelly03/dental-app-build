import { Plus } from 'lucide-react';
import { formatDate } from '../utils/localDate';
import type { ApiTreatment } from '../api/types';

// The Treatment History tab — the chairside free-text record (diagnosis,
// treatment done, remarks), distinct from what the odontogram holds per tooth.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged.
//
// ⚠ FIRST OF THE SIX THAT ACTUALLY SHARES STATE WITH THE HOST. The add-entry
// form is host state — it must survive this tab being switched away from and
// back — so it stays there and arrives as one `addForm` object rather than
// seven loose props. Bundling it keeps the seam legible: everything this panel
// can CHANGE is in one place, and everything else it receives is read-only.

export interface TreatmentAddForm {
  open: boolean;
  setOpen: (open: boolean) => void;
  values: { date: string; diagnosis: string; treatmentDone: string; remarks: string };
  setValues: React.Dispatch<React.SetStateAction<{ date: string; diagnosis: string; treatmentDone: string; remarks: string }>>;
  error: string | null;
  saving: boolean;
  onSave: () => void;
}

export function TreatmentHistoryTab({
  treatments,
  dentistNameById,
  schoolYear,
  canEdit,
  staffNameLabel,
  staffName,
  addForm,
}: {
  treatments: ApiTreatment[];
  dentistNameById: Map<string, string>;
  /** The school year the new entry would be filed under — undefined when no
   *  year is selected, which is why the Add button is gated on it. */
  schoolYear: string | undefined;
  canEdit: boolean;
  staffNameLabel: string;
  staffName: string;
  addForm: TreatmentAddForm;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Treatment History</h3>
        {canEdit && schoolYear && (
          <button onClick={() => addForm.setOpen(!addForm.open)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover">
            <Plus className="w-3.5 h-3.5" /> Add Entry
          </button>
        )}
      </div>
      {addForm.open && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <p className="text-xs text-blue-700">Adding to school year: <strong>{schoolYear}</strong></p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-foreground mb-1">Date</label>
              <input type="date" value={addForm.values.date} onChange={(e) => addForm.setValues((f) => ({ ...f, date: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">{staffNameLabel}</label>
              <input type="text" value={staffName} readOnly className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-gray-50 cursor-default text-foreground" /></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">Diagnosis</label>
              <textarea rows={2} value={addForm.values.diagnosis} onChange={(e) => addForm.setValues((f) => ({ ...f, diagnosis: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></div>
            <div><label className="block text-xs font-medium text-foreground mb-1">Treatment Done</label>
              <textarea rows={2} value={addForm.values.treatmentDone} onChange={(e) => addForm.setValues((f) => ({ ...f, treatmentDone: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none" /></div>
            <div className="md:col-span-2"><label className="block text-xs font-medium text-foreground mb-1">Remarks</label>
              <input type="text" value={addForm.values.remarks} onChange={(e) => addForm.setValues((f) => ({ ...f, remarks: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          </div>
          {addForm.error && <p className="text-xs text-destructive">{addForm.error}</p>}
          <div className="flex gap-2">
            <button onClick={addForm.onSave} disabled={addForm.saving} className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60">{addForm.saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => addForm.setOpen(false)} className="px-4 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
      {treatments.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">No treatment records yet.</p>
      ) : (
      <>
      <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>{['Date', 'Diagnosis', 'Treatment Done', 'Dentist', 'Remarks'].map((h) => (
              <th key={h} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-card">
            {treatments.map((t) => (
              <tr key={t._id} className="hover:bg-gray-50">
                <td className="px-4 py-2 whitespace-nowrap font-medium text-foreground text-xs">{formatDate(t.date)}</td>
                <td className="px-4 py-2 text-xs text-foreground">{t.diagnosis}</td>
                <td className="px-4 py-2 text-xs text-foreground">{t.treatment_done}</td>
                <td className="px-4 py-2 whitespace-nowrap text-xs text-foreground">{dentistNameById.get(t.dentist_id) ?? 'Unknown'}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{t.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Cards below md: the five-column table cannot survive phone width, and
          CLAUDE.md's three device classes include the phone in the field. */}
      <div className="md:hidden space-y-3">
        {treatments.map((t) => (
          <div key={t._id} className="rounded-lg border bg-card border-border p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground text-xs">{formatDate(t.date)}</span>
              <span className="text-xs text-muted-foreground">{dentistNameById.get(t.dentist_id) ?? 'Unknown'}</span>
            </div>
            <p className="text-xs text-muted-foreground"><span className="font-medium">Dx:</span> {t.diagnosis}</p>
            <p className="text-xs text-muted-foreground"><span className="font-medium">Tx:</span> {t.treatment_done}</p>
            {t.remarks && <p className="text-xs text-muted-foreground italic">{t.remarks}</p>}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
