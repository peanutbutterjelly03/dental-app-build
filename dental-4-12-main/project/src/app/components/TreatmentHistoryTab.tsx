import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRiskClassification } from '../hooks/useRiskClassification';
import type { IptrYearData } from '../hooks/useDentalChartData';
import { formatDate } from '../utils/localDate';
import { addTreatmentQueueStudentId, getTreatmentQueueStudentIds } from '../utils/treatmentQueueStorage';
import { suggestTreatments, type RiskLevel } from '../../../shared/riskTreatments';
import { treatmentCodes, treatmentLabel } from '../../../shared/treatmentCodes';
import type { ApiTreatment } from '../api/types';

// The Treatment tab (user pick "A", 2026-10-05): a mouth chart that filters a
// timeline. Everything here is READ from records the system already has; the
// only thing this tab writes is the chairside note (the Add Entry form), as before.
//
// Sources, each marked on its line: chairside notes (TREATMENT, free text),
// treatments charted on a tooth (TOOTH_RECORD.treatment_code), services given
// at an RPC visit (PREVENTIVE_CARE_RECORD), risk review decisions
// (RISK_STRATIFICATION) and referrals (REFERRAL). A note counts as being about
// a tooth only when its text says "tooth 54" or "teeth 54, 46" (see TOOTH_MENTION).
// Suggested treatments are the fixed rules in shared/riskTreatments.ts and are
// accepted or skipped on the Risk Classification page, never here.
// Appointments are not shown: this screen has no per-student appointment read.

export interface TreatmentAddForm {
  open: boolean;
  setOpen: (open: boolean) => void;
  values: { date: string; diagnosis: string; treatmentDone: string; remarks: string };
  setValues: React.Dispatch<React.SetStateAction<{ date: string; diagnosis: string; treatmentDone: string; remarks: string }>>;
  error: string | null;
  saving: boolean;
  onSave: () => void;
}

type Source = 'note' | 'tooth' | 'svc' | 'risk' | 'ref';
interface Ev {
  key: string;
  date: string;
  year: string;
  src: Source;
  title: string;
  body?: string;
  note?: string;
  meta?: string;
  code?: string;
  tooth?: number;
  teeth: number[];
}

const SOURCE: Record<Source, { label: string; cls: string }> = {
  note: { label: 'Chairside note', cls: 'bg-primary-surface text-primary border-primary-surface' },
  tooth: { label: 'Charted on tooth', cls: 'bg-teal-100 text-teal-800 border-teal-300' },
  svc: { label: 'RPC service', cls: 'bg-green-100 text-green-800 border-green-300' },
  risk: { label: 'Risk review', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  ref: { label: 'Referral', cls: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300' },
};
const FILTERS: [Source | 'all', string][] = [['all', 'Everything'], ['note', 'Notes'], ['tooth', 'On teeth'], ['svc', 'RPC services'], ['risk', 'Risk review'], ['ref', 'Referrals']];

const SERVICE_FIELDS: [string, string][] = [
  ['oral_screening', 'OEX'], ['oral_prophylaxis', 'OP'], ['fluoride_varnish', 'FV'], ['oral_hygiene_instruction', 'OHI'], ['consultation', 'CONS'],
];
const codeName = (code: string) => {
  const t = treatmentCodes.find((x) => x.code === code);
  return t ? treatmentLabel(t) : code === 'OHI' ? 'Oral hygiene instruction' : code;
};

// "tooth 54", "teeth 54, 46 and 16", "tooth #74". Bare numbers are ignored on purpose.
const TOOTH_MENTION = /\b(?:tooth|teeth)\s*#?\s*((?:\d{2}\s*(?:,|and|&|\/)?\s*)+)/gi;
const FDI = /^(?:[1-4][1-8]|[5-8][1-5])$/;
const teethIn = (text: string): number[] => {
  const out = new Set<number>();
  for (const m of text.matchAll(TOOTH_MENTION)) {
    for (const n of m[1].match(/\d{2}/g) ?? []) if (FDI.test(n)) out.add(Number(n));
  }
  return [...out];
};

const QUADRANT: Record<number, string> = { 1: 'Upper right', 2: 'Upper left', 3: 'Lower left', 4: 'Lower right', 5: 'Upper right', 6: 'Upper left', 7: 'Lower left', 8: 'Lower right' };
const ADULT_POS = ['', 'central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar'];
const BABY_POS = ['', 'central incisor', 'lateral incisor', 'canine', 'first molar', 'second molar'];
const toothName = (n: number) => {
  const q = Math.floor(n / 10);
  const baby = q >= 5;
  return `${QUADRANT[q]} ${(baby ? BABY_POS : ADULT_POS)[n % 10]}${baby ? ' (baby tooth)' : ''}`;
};
const CONDITION_LABEL: Record<string, string> = {
  D: 'Decayed permanent tooth', d: 'Decayed baby tooth', F: 'Filled permanent tooth', f: 'Filled baby tooth',
  M: 'Missing permanent tooth', X: 'Extracted permanent tooth', x: 'Extracted baby tooth', '✓': 'Sound', '√': 'Sound',
};
const ROWS: { label: string; teeth: (number | '|')[] }[] = [
  { label: 'Adult teeth, upper', teeth: [18, 17, 16, 15, 14, 13, 12, 11, '|', 21, 22, 23, 24, 25, 26, 27, 28] },
  { label: 'Baby teeth, upper', teeth: [55, 54, 53, 52, 51, '|', 61, 62, 63, 64, 65] },
  { label: 'Baby teeth, lower', teeth: [85, 84, 83, 82, 81, '|', 71, 72, 73, 74, 75] },
  { label: 'Adult teeth, lower', teeth: [48, 47, 46, 45, 44, 43, 42, 41, '|', 31, 32, 33, 34, 35, 36, 37, 38] },
];

const toothTone = (condition: string | undefined, hasTx: boolean) => {
  if (condition === 'D' || condition === 'd') return 'border-red-300 bg-red-100 text-red-700';
  if (condition === 'F' || condition === 'f') return 'border-blue-400 bg-blue-100 text-blue-700';
  if (hasTx) return 'border-teal-300 bg-teal-100 text-teal-800';
  if (condition === 'M' || condition === 'X' || condition === 'x') return 'border-dashed border-slate-300 bg-slate-100 text-slate-500';
  return 'border-border bg-card text-muted-foreground';
};

const Chip = ({ tone, children }: { tone?: 'ok' | 'warn'; children: React.ReactNode }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone === 'ok' ? 'border-green-300 bg-green-100 text-green-800' : tone === 'warn' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-border bg-muted/40 text-foreground'}`}>{children}</span>
);
const Code = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-md bg-primary-surface px-2 py-0.5 text-[11px] font-extrabold text-primary">{children}</span>
);
const Panel = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="min-w-0 space-y-2.5 rounded-xl border border-border bg-card p-3.5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[13px] font-bold text-foreground">{title}</h3>{right}</div>
    {children}
  </div>
);

interface RiskRow {
  _id: string;
  preventive_id: string;
  risk_level: RiskLevel;
  validated_by_dentist: boolean;
  validated_at: string | null;
  model_risk_level: RiskLevel | null;
  treatment_decisions?: { code: string; tooth: number | null; decision: 'accepted' | 'skipped'; skip_reason: string | null }[];
}

export function TreatmentHistoryTab({
  studentId,
  years,
  treatments: _treatments,
  dentistNameById,
  schoolYear,
  canEdit,
  staffNameLabel,
  staffName,
  addForm,
}: {
  studentId: string;
  years: IptrYearData[];
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
  const { selectedSchool } = useAuth();
  const [filter, setFilter] = useState<Source | 'all'>('all');
  const [dentition, setDentition] = useState<'baby' | 'adult' | 'both'>('both');
  const [sel, setSel] = useState<number | null>(null);
  const [queued, setQueued] = useState(() => getTreatmentQueueStudentIds().includes(studentId));

  // Risk: the suggestion waiting for review (treatments to confirm), and the
  // stored reviews of every visit (decisions shown on the timeline).
  const { candidates } = useRiskClassification({ studentId, school: selectedSchool ?? '' });
  const cand = candidates[0] ?? null;
  const visitIds = useMemo(
    () => years.flatMap((y) => [y.preventivesByVisitNumber[1], y.preventivesByVisitNumber[2]]).filter((v): v is NonNullable<typeof v> => !!v).map((v) => v._id),
    [years],
  );
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const idsKey = visitIds.join(',');
  useEffect(() => {
    if (!idsKey) { setRiskRows([]); return; }
    let cancelled = false;
    apiClient.get<RiskRow[]>(`/risk-stratifications?preventive_id=${idsKey}`)
      .then((r) => { if (!cancelled) setRiskRows(r); })
      .catch(() => { if (!cancelled) setRiskRows([]); });
    return () => { cancelled = true; };
  }, [idsKey]);

  const events = useMemo<Ev[]>(() => {
    const out: Ev[] = [];
    const visitById = new Map<string, { date: string; year: string; n: number }>();
    for (const y of years) {
      const year = y.iptr.school_year;
      for (const n of [1, 2] as const) {
        const p = y.preventivesByVisitNumber[n];
        if (!p) continue;
        const date = p.visit_date.slice(0, 10);
        visitById.set(p._id, { date, year, n });
        for (const [field, code] of SERVICE_FIELDS) {
          if ((p as unknown as Record<string, unknown>)[field] === true) {
            out.push({ key: `svc-${p._id}-${code}`, date, year, src: 'svc', code, title: codeName(code), meta: `Visit ${n}`, teeth: [] });
          }
        }
      }
      for (const t of y.treatments) {
        out.push({
          key: `note-${t._id}`, date: t.date.slice(0, 10), year, src: 'note', title: t.diagnosis || 'Treatment note', body: t.treatment_done,
          note: t.remarks, meta: dentistNameById.get(t.dentist_id) ?? 'Unknown', teeth: teethIn(`${t.diagnosis} ${t.treatment_done} ${t.remarks}`),
        });
      }
      const dateOfChart = new Map(y.charts.map((c) => [c._id, c.date_charted.slice(0, 10)]));
      const seen = new Set<string>();
      for (const [chartId, records] of Object.entries(y.toothRecordsByChart)) {
        for (const r of records) {
          if (!r.treatment_code) continue;
          const k = `${year}-${r.tooth_number}-${r.treatment_code}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({
            key: `tooth-${chartId}-${r.tooth_number}-${r.treatment_code}`, date: dateOfChart.get(chartId) ?? y.iptr.school_year, year, src: 'tooth', code: r.treatment_code,
            tooth: r.tooth_number, title: `${codeName(r.treatment_code)} on tooth ${r.tooth_number}`, meta: r.visit_number ? `Visit ${r.visit_number}` : undefined, teeth: [r.tooth_number],
          });
        }
      }
      for (const r of y.referrals) {
        out.push({
          key: `ref-${r._id}`, date: r.date_issued.slice(0, 10), year, src: 'ref',
          title: `Referral: ${r.referral_type.replace(/_/g, ' ')}${r.facility_name ? `, ${r.facility_name}` : ''}`, meta: `Status: ${r.status}`, teeth: [],
        });
      }
    }
    for (const r of riskRows) {
      if (!r.validated_by_dentist) continue;
      const visit = visitById.get(r.preventive_id);
      const decisions = r.treatment_decisions ?? [];
      const dsum = decisions.map((d) => `${d.code}${d.tooth ? ` ${d.tooth}` : ''} ${d.decision}${d.skip_reason ? ` (${d.skip_reason})` : ''}`).join('; ');
      out.push({
        key: `risk-${r._id}`, date: (r.validated_at ?? visit?.date ?? '').slice(0, 10), year: visit?.year ?? '', src: 'risk',
        title: `${r.risk_level} risk confirmed${r.model_risk_level && r.model_risk_level !== r.risk_level ? ` (system suggested ${r.model_risk_level})` : ''}`,
        body: dsum || undefined, teeth: decisions.map((d) => d.tooth).filter((t): t is number => typeof t === 'number'),
      });
    }
    return out.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
  }, [years, riskRows, dentistNameById]);

  // The latest charted condition per tooth, from the newest year that has any.
  const conditionByTooth = useMemo(() => {
    const m = new Map<number, string>();
    const latest = [...years].sort((a, b) => b.iptr.school_year.localeCompare(a.iptr.school_year)).find((y) => y.dmftToothRecords && y.dmftToothRecords.length);
    for (const r of latest?.dmftToothRecords ?? []) if (r.condition) m.set(r.tooth_number, r.condition);
    return m;
  }, [years]);
  const treatedLatest = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of events) if (e.src === 'tooth' && e.tooth && !m.has(e.tooth)) m.set(e.tooth, e.code ?? '');
    return m;
  }, [events]);

  const waiting = useMemo(() => {
    if (!cand || cand.status !== 'needs_review' || !cand.suggestion) return [];
    return suggestTreatments(cand.teeth, cand.suggestion.level);
  }, [cand]);
  const waitingTeeth = useMemo(() => new Set(waiting.map((w) => w.tooth).filter((t): t is number => t !== null)), [waiting]);

  const shown = events.filter((e) => (filter === 'all' || e.src === filter) && (sel === null || e.teeth.includes(sel)));
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [shown]);

  const wholeMouth = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of events) if (e.src === 'svc' && e.code) c.set(e.code, (c.get(e.code) ?? 0) + 1);
    return [...c.entries()];
  }, [events]);
  const teethTreated = new Set(events.filter((e) => e.src === 'tooth').map((e) => e.tooth)).size;
  const lastTreatment = events.find((e) => e.src === 'note' || e.src === 'tooth' || e.src === 'svc');

  const addToQueue = () => { addTreatmentQueueStudentId(studentId); setQueued(true); };
  const addForTooth = (n: number) => {
    addForm.setValues((f) => ({ ...f, diagnosis: f.diagnosis || `Tooth ${n}: ` }));
    addForm.setOpen(true);
  };

  const rows = ROWS.filter((r) => dentition === 'both' || (dentition === 'baby' ? r.label.startsWith('Baby') : r.label.startsWith('Adult')));
  const nothing = events.length === 0 && conditionByTooth.size === 0 && waiting.length === 0;
  const selCondition = sel !== null ? conditionByTooth.get(sel) : undefined;
  const selWaiting = sel !== null ? waiting.filter((w) => w.tooth === sel) : [];
  const selMentions = sel !== null ? events.filter((e) => e.teeth.includes(sel)).length : 0;

  return (
    <div className="space-y-3.5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Treatment History</h3>
        {canEdit && schoolYear && (
          <button onClick={() => addForm.setOpen(!addForm.open)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover">
            <Plus className="h-3.5 w-3.5" /> Add Entry
          </button>
        )}
      </div>

      {addForm.open && (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs text-blue-700">Adding to school year: <strong>{schoolYear}</strong></p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><label className="mb-1 block text-xs font-medium text-foreground">Date</label>
              <input type="date" value={addForm.values.date} onChange={(e) => addForm.setValues((f) => ({ ...f, date: e.target.value }))} className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div><label className="mb-1 block text-xs font-medium text-foreground">{staffNameLabel}</label>
              <input type="text" value={staffName} readOnly className="w-full cursor-default rounded-lg border border-border bg-gray-50 px-3 py-1.5 text-sm text-foreground" /></div>
            <div><label className="mb-1 block text-xs font-medium text-foreground">Diagnosis</label>
              <textarea rows={2} value={addForm.values.diagnosis} onChange={(e) => addForm.setValues((f) => ({ ...f, diagnosis: e.target.value }))} className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div><label className="mb-1 block text-xs font-medium text-foreground">Treatment Done</label>
              <textarea rows={2} value={addForm.values.treatmentDone} onChange={(e) => addForm.setValues((f) => ({ ...f, treatmentDone: e.target.value }))} className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
            <div className="md:col-span-2"><label className="mb-1 block text-xs font-medium text-foreground">Remarks</label>
              <input type="text" value={addForm.values.remarks} onChange={(e) => addForm.setValues((f) => ({ ...f, remarks: e.target.value }))} className="w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          </div>
          {addForm.error && <p className="text-xs text-destructive">{addForm.error}</p>}
          <div className="flex gap-2">
            <button onClick={addForm.onSave} disabled={addForm.saving} className="rounded-lg bg-primary px-4 py-1.5 text-sm text-white hover:bg-primary-hover disabled:opacity-60">{addForm.saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => addForm.setOpen(false)} className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {nothing ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <div className="text-sm font-bold">No treatment records yet</div>
          <p className="mx-auto max-w-prose text-xs text-muted-foreground">Chairside notes, treatments charted on teeth and services given at RPC visits appear here, and the chart colors in as teeth are charted.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Last treatment</div><div className="text-base font-extrabold">{lastTreatment ? formatDate(lastTreatment.date) : 'None yet'}</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Teeth treated</div><div className="text-2xl font-extrabold tabular-nums">{teethTreated}</div></div>
            <div className="rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Waiting to confirm</div><div className={`text-2xl font-extrabold tabular-nums ${waiting.length ? 'text-amber-700' : ''}`}>{waiting.length}</div><div className="text-xs text-muted-foreground">on Risk Classification</div></div>
            <div className="rounded-xl border border-border bg-card p-3 space-y-1">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Treatment queue</div>
              {queued ? <Chip tone="ok">In the queue</Chip> : canEdit ? <button onClick={addToQueue} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted">Add to treatment queue</button> : <Chip>Not in the queue</Chip>}
            </div>
          </div>

          <Panel title="Whole-mouth treatments given">
            <div className="flex flex-wrap gap-1.5">
              {wholeMouth.length ? wholeMouth.map(([code, n]) => (
                <span key={code} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-semibold"><Code>{code}</Code>{codeName(code)}{n > 1 ? ` x${n}` : ''}</span>
              )) : <span className="text-xs text-muted-foreground">None yet</span>}
            </div>
          </Panel>

          <Panel title="Mouth chart" right={
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              {([['baby', 'Baby'], ['adult', 'Adult'], ['both', 'Both']] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={dentition === k} onClick={() => setDentition(k)}
                  className={`px-3 py-1 text-xs font-semibold ${dentition === k ? 'bg-primary text-white' : 'bg-card text-foreground hover:bg-muted'} ${k !== 'baby' ? 'border-l border-border' : ''}`}>{l}</button>
              ))}
            </div>}>
            <div className="space-y-2 overflow-x-auto pb-3">
              {rows.map((row) => (
                <div key={row.label} className="space-y-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{row.label}</div>
                  <div className="flex gap-1">
                    {row.teeth.map((n, i) => n === '|' ? <span key={`g${i}`} className="w-2.5 flex-shrink-0" /> : (
                      <button key={n} type="button" onClick={() => setSel(sel === n ? null : n)} aria-pressed={sel === n}
                        title={`Tooth ${n}${conditionByTooth.get(n) ? `: ${CONDITION_LABEL[conditionByTooth.get(n) as string] ?? conditionByTooth.get(n)}` : ''}`}
                        className={`relative grid h-9 w-[1.875rem] flex-shrink-0 place-items-center rounded-[0.5rem_0.5rem_0.75rem_0.75rem] border-[1.5px] text-[10px] font-bold ${toothTone(conditionByTooth.get(n), treatedLatest.has(n))} ${sel === n ? 'outline outline-2 outline-offset-2 outline-primary' : ''}`}>
                        {n}
                        {waitingTeeth.has(n) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-amber-500" />}
                        {treatedLatest.get(n) && <span className="absolute -bottom-2.5 rounded-md border border-border bg-card px-1 text-[9px] font-extrabold text-primary">{treatedLatest.get(n)}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-red-300 bg-red-100 align-[-1px]" />Decayed</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-blue-400 bg-blue-100 align-[-1px]" />Filled</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-teal-300 bg-teal-100 align-[-1px]" />Treated or sealed</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-500 align-[-1px]" />Suggested treatment waiting</span>
            </div>
          </Panel>

          {sel === null ? (
            <Panel title="Tooth card"><p className="text-xs text-muted-foreground">Press a tooth on the chart to see its condition, its treatments and what is suggested for it. The timeline below then shows only that tooth.</p></Panel>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-primary bg-card p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Tooth {sel}</div><div className="text-[15px] font-extrabold">{toothName(sel)}</div></div>
                <div className="flex flex-wrap items-center gap-2">
                  {selCondition ? <Chip tone={selCondition === 'D' || selCondition === 'd' ? 'warn' : 'ok'}>{CONDITION_LABEL[selCondition] ?? selCondition}</Chip> : <Chip>Nothing charted</Chip>}
                  <button type="button" onClick={() => setSel(null)} className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted">Show all teeth</button>
                </div>
              </div>
              {selWaiting.map((w, i) => (
                <div key={`${w.code}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                  <Code>{w.code}</Code>
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{codeName(w.code)}</div><div className="text-xs text-muted-foreground">{w.why}</div></div>
                  <Chip tone="warn">To confirm</Chip>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{selMentions} record{selMentions === 1 ? '' : 's'} mention this tooth.</p>
              {canEdit && schoolYear && <button type="button" onClick={() => addForTooth(sel)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover">Add entry for tooth {sel}</button>}
            </div>
          )}

          <Panel title="Timeline">
            {sel !== null && <div><span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Showing tooth {sel} only <button type="button" onClick={() => setSel(null)} aria-label="Show everything" className="font-extrabold">&times;</button></span></div>}
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === k ? 'border-primary bg-primary text-white' : 'border-border bg-card text-foreground hover:bg-muted'}`}>{l}</button>
              ))}
            </div>
            {byDay.length === 0 ? <p className="text-xs text-muted-foreground">Nothing recorded for this selection.</p> : (
              <div className="space-y-1">
                {byDay.map(([day, evs]) => (
                  <div key={day} className="relative ml-1.5 space-y-1 border-l-2 border-border pl-3.5">
                    <div className="flex items-center gap-2 pt-1.5">
                      <span className="absolute -left-[0.4375rem] h-3 w-3 rounded-full border-2 border-card bg-primary" />
                      <b className="text-[13px]">{formatDate(day)}</b>
                      {evs[0].year && <Chip>SY {evs[0].year}</Chip>}
                    </div>
                    {evs.map((e) => (
                      <div key={e.key} className="flex items-start gap-2.5 py-1.5">
                        <span className={`mt-0.5 inline-block flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${SOURCE[e.src].cls}`}>{SOURCE[e.src].label}</span>
                        <div className="min-w-0 text-[13px]">
                          <div className="font-bold">{e.code && e.src !== 'note' ? <><Code>{e.code}</Code> </> : null}{e.title}</div>
                          {e.body && <div>{e.body}</div>}
                          {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
                          {e.meta && <div className="text-xs text-muted-foreground">{e.meta}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">Treatment suggestions are computer-assisted and fixed-rule. The dentist decides what is done.</p>
    </div>
  );
}
