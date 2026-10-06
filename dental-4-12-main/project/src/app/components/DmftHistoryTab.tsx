import { useMemo } from 'react';
import { computeDMFT, type ChartEntry } from '../utils/dentalChartCodes';
import { useAuth } from '../context/AuthContext';
import { useRiskClassification } from '../hooks/useRiskClassification';
import { ageOn } from '../utils/age';
import { hasCaries, type ChartedTooth } from '../../../shared/iptrSectionB';
import type { IptrYearData } from '../hooks/useDentalChartData';

// "Orally Fit Child" per year (2026-09-25) — same rule DentalChart.tsx's live
// derivation uses, read from the SAVED data instead of the draft being
// edited: no oral condition present (dental caries included, derived from the
// teeth same as there) and no tooth carrying a treatment code. A year with no
// charting is never OFC -- there is nothing to call fit.
function isYearOrallyFitChild(y: IptrYearData): boolean {
  const rows = y.dmftToothRecords;
  if (!rows) return false;
  const charted: ChartedTooth[] = rows.map((t) => ({
    tooth: t.tooth_number,
    condition: t.condition,
    treatment: t.treatment_code,
  }));
  const oc = y.oralCondition;
  const anyCondition =
    hasCaries(charted) ||
    !!oc?.gingivitis ||
    !!oc?.periodontal_disease ||
    !!oc?.debris ||
    !!oc?.calculus ||
    !!oc?.abnormal_growth ||
    !!oc?.cleft_lip_palate;
  return !anyCondition && !charted.some((t) => t.treatment);
}

// The Dental History tab (user pick: the summary tiles and line chart, then the
// "years across, findings down" grid, 2026-10-06). Everything is READ from
// records the system already has.
//
// ⚠ A school year with no charting is NOT RECORDED, never zero (BUG-12): its
// grid column is hatched and its chart point is a gap. "Confirmed risk" reads
// VALIDATED results only. Baby teeth are shed, so dmft can fall without the
// child improving; the tiles therefore show dmft and DMFT side by side and the
// old one-word "Trend" tile is gone (it read the adult figure alone, which
// can only rise).

type Level = 'High' | 'Medium' | 'Low';
const PILL: Record<Level, string> = {
  High: 'border-red-300 bg-red-100 text-red-700',
  Medium: 'border-amber-300 bg-amber-100 text-amber-800',
  Low: 'border-green-300 bg-green-100 text-green-800',
};
const TONE = { baby: '#DC2626', adult: '#2563EB' };
const CONDITION_LABELS: [keyof NonNullable<IptrYearData['oralCondition']>, string][] = [
  ['gingivitis', 'Gingivitis'], ['periodontal_disease', 'Periodontal disease'], ['debris', 'Debris'],
  ['calculus', 'Calculus'], ['abnormal_growth', 'Abnormal growth'], ['cleft_lip_palate', 'Cleft lip or palate'],
];
const QUADRANT: Record<number, string> = { 1: 'Upper right', 2: 'Upper left', 3: 'Lower left', 4: 'Lower right', 5: 'Upper right', 6: 'Upper left', 7: 'Lower left', 8: 'Lower right' };
const ADULT_POS = ['', 'central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar'];
const BABY_POS = ['', 'central incisor', 'lateral incisor', 'canine', 'first molar', 'second molar'];
const toothName = (n: number) => {
  const q = Math.floor(n / 10);
  const baby = q >= 5;
  return `${QUADRANT[q]} ${(baby ? BABY_POS : ADULT_POS)[n % 10]}${baby ? ' (baby tooth)' : ''}`;
};
const FINDING = new Set(['D', 'M', 'F', 'X', 'd', 'm', 'f', 'x', 'dx', 'DX']);
const SOUND = new Set(['✓', '√']);

interface YearRow {
  year: string;
  grade: string;
  age: number | null;
  recorded: boolean;
  d: number; m: number; f: number; x: number; t: number;
  D: number; M: number; F: number; X: number; T: number;
  ofc: boolean;
  free: number | null;
  treatments: number;
  conditions: string[];
  teeth: number[];
  decayedTeeth: number[];
  visitDates: Set<string>;
}

export function DmftHistoryTab({ years, studentId, birthday }: { years: IptrYearData[]; studentId: string; birthday: string | null | undefined }) {
  const { selectedSchool } = useAuth();
  const { candidates } = useRiskClassification({ studentId, school: selectedSchool ?? '' });
  const history = candidates[0]?.history ?? [];

  const rows = useMemo<YearRow[]>(() => years.map((y) => {
    const year = y.iptr.school_year;
    const start = Number(year.slice(0, 4));
    const visitDates = new Set(([1, 2] as const).map((n) => y.preventivesByVisitNumber[n]?.visit_date.slice(0, 10)).filter((v): v is string => !!v));
    const treatments = y.treatments.length + new Set(Object.values(y.toothRecordsByChart).flat().filter((r) => r.treatment_code).map((r) => `${r.tooth_number}-${r.treatment_code}`)).size;
    const base = {
      year, grade: y.iptr.grade_level ?? '', age: Number.isFinite(start) ? ageOn(birthday, new Date(start, 7, 1)) : null,
      treatments, visitDates,
      conditions: CONDITION_LABELS.filter(([k]) => y.oralCondition?.[k] === true).map(([, l]) => l),
    };
    const recs = y.dmftToothRecords;
    if (!recs) return { ...base, recorded: false, d: 0, m: 0, f: 0, x: 0, t: 0, D: 0, M: 0, F: 0, X: 0, T: 0, ofc: false, free: null, teeth: [], decayedTeeth: [] };
    const chart: Record<number, ChartEntry> = {};
    for (const tr of recs) chart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
    const c = computeDMFT(chart);
    return {
      ...base, recorded: true, ...c, ofc: isYearOrallyFitChild(y),
      free: recs.filter((r) => SOUND.has(r.condition)).length,
      teeth: recs.filter((r) => FINDING.has(r.condition)).map((r) => r.tooth_number).sort((a, b) => a - b),
      decayedTeeth: recs.filter((r) => r.condition === 'D' || r.condition === 'd').map((r) => r.tooth_number).sort((a, b) => a - b),
    };
  }), [years, birthday]);

  const riskOf = (r: YearRow): Level | null => {
    const hit = [...history].reverse().find((h) => r.visitDates.has(h.visitDate));
    return hit ? hit.riskLevel : null;
  };

  if (rows.length === 0) {
    return <div className="p-8 text-center text-muted-foreground text-sm">No records yet.</div>;
  }
  const recorded = rows.filter((r) => r.recorded);
  if (recorded.length === 0) {
    return (
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-bold text-foreground">Dental History</h3>
        <div className="space-y-1 rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
          <div className="text-sm font-bold">Nothing has been charted yet</div>
          <p className="text-xs text-muted-foreground">The history fills in after the first dental charting. Years without a charting are listed as not recorded.</p>
        </div>
      </div>
    );
  }
  const latest = recorded[recorded.length - 1];
  const prev = recorded.length > 1 ? recorded[recorded.length - 2] : null;
  const latestRisk = [...recorded].reverse().map(riskOf).find((v) => v !== null) ?? null;
  const decayedNow = latest.decayedTeeth;

  const delta = (a: number, b: number | undefined) => {
    if (b === undefined) return null;
    const d = a - b;
    return d === 0
      ? <span className="text-xs text-muted-foreground">no change</span>
      : <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${d > 0 ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-green-300 bg-green-100 text-green-800'}`}>{d > 0 ? '+' : ''}{d}</span>;
  };

  // Line chart: one line per figure, a gap where a year was not charted.
  const W = 520, H = 210, PX = 60, PY = 24;
  const mx = Math.max(4, ...recorded.flatMap((r) => [r.t, r.T])) + 1;
  const xAt = (i: number) => (rows.length > 1 ? PX + (i * (W - PX - 30)) / (rows.length - 1) : W / 2);
  const yAt = (v: number) => H - 34 - (v / mx) * (H - 34 - PY);
  const seg = (pick: (r: YearRow) => number, col: string) => {
    let d = ''; let pen = false;
    rows.forEach((r, i) => { if (!r.recorded) { pen = false; return; } d += `${pen ? 'L' : 'M'}${xAt(i)} ${yAt(pick(r))} `; pen = true; });
    return <path d={d} fill="none" stroke={col} strokeWidth="2.5" />;
  };
  const dots = (pick: (r: YearRow) => number, col: string) => rows.map((r, i) => r.recorded && (
    <g key={`${col}-${r.year}`}>
      <circle cx={xAt(i)} cy={yAt(pick(r))} r="5" fill={col} />
      <text x={xAt(i)} y={yAt(pick(r)) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill={col}>{pick(r)}</text>
    </g>
  ));

  // Grid
  const heatMax = Math.max(3, ...recorded.flatMap((r) => [r.d, r.m, r.f, r.x, r.D, r.M, r.F, r.X]));
  const heat = (v: number) => (v ? { background: `rgba(220,38,38,${Math.min(0.5, (v / heatMax) * 0.5)})` } : undefined);
  const hatch = { background: 'repeating-linear-gradient(45deg,var(--border),var(--border) 4px,transparent 4px,transparent 8px)', opacity: 0.6 };
  const cell = (r: YearRow, content: React.ReactNode, style?: React.CSSProperties) => (
    <td key={r.year} className="min-w-[7rem] px-2 py-1.5 text-center text-[13px]" style={r.recorded ? style : hatch}>{r.recorded ? content : ''}</td>
  );
  const rowHead = 'sticky left-0 z-[1] whitespace-nowrap bg-card px-2.5 py-1.5 text-left text-xs font-semibold';
  const group = (label: string) => (
    <tr><th colSpan={rows.length + 1} className="sticky left-0 bg-muted/40 px-2.5 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</th></tr>
  );
  const count = (label: string, pick: (r: YearRow) => number, shade = true, strong = false) => (
    <tr className="border-t border-border">
      <th className={`${rowHead} ${strong ? 'bg-muted/40 font-extrabold' : ''}`}>{label}</th>
      {rows.map((r) => cell(r, strong ? <b>{pick(r)}</b> : pick(r) || '', shade ? heat(pick(r)) : undefined))}
    </tr>
  );
  const text = (label: string, pick: (r: YearRow) => React.ReactNode) => (
    <tr className="border-t border-border"><th className={rowHead}>{label}</th>{rows.map((r) => cell(r, pick(r)))}</tr>
  );
  const yn = (v: boolean) => (v ? 'Yes' : 'No');

  return (
    <div className="space-y-3.5 p-4">
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Dental history</div>
        <h3 className="text-base font-extrabold text-foreground">DMFT Progression by School Year</h3>
      </div>

      {/* Needs attention */}
      <div className={`space-y-1 rounded-xl border border-border border-l-4 bg-card p-3.5 ${decayedNow.length ? 'border-l-amber-500' : 'border-l-green-500'}`}>
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Needs attention</div>
        {decayedNow.length ? (
          <>
            <div className="text-sm font-bold">{decayedNow.length} tooth{decayedNow.length === 1 ? ' is' : 's are'} still charted as decayed: {decayedNow.map((n) => `${n} (${toothName(n)})`).join(', ')}.</div>
            <div className="text-xs text-muted-foreground">From the {latest.year} charting. Suggested treatments are on the Treatment tab; the dentist decides.</div>
          </>
        ) : <div className="text-sm font-bold">No tooth is currently charted as decayed.</div>}
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <div className="space-y-0.5 rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Latest dmft (baby)</div><div className="text-2xl font-extrabold tabular-nums">{latest.t}</div>{prev && delta(latest.t, prev.t)}</div>
        <div className="space-y-0.5 rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Latest DMFT (adult)</div><div className="text-2xl font-extrabold tabular-nums">{latest.T}</div>{prev && delta(latest.T, prev.T)}</div>
        <div className="space-y-0.5 rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Years charted</div><div className="text-2xl font-extrabold tabular-nums">{recorded.length}</div><div className="text-xs text-muted-foreground">of {rows.length} on file</div></div>
        <div className="space-y-0.5 rounded-xl border border-border bg-card p-3"><div className="text-[10.5px] font-bold tracking-wide text-muted-foreground">Confirmed risk</div><div className="text-2xl font-extrabold">{latestRisk ?? 'None yet'}</div><div className="text-xs text-muted-foreground">latest charted year</div></div>
      </div>

      {/* Chart */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-3.5">
        <h3 className="text-[13px] font-bold">dmft and DMFT by school year</h3>
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto max-h-56 w-full max-w-xl" role="img" aria-label="dmft and DMFT by school year">
          {[0, Math.round(mx / 2), mx].map((v) => (
            <g key={v}><line x1={PX - 8} x2={W - 20} y1={yAt(v)} y2={yAt(v)} stroke="var(--border)" /><text x="0" y={yAt(v) + 4} fontSize="11" fill="var(--muted-foreground)">{v}</text></g>
          ))}
          {rows.map((r, i) => !r.recorded && (
            <g key={`gap-${r.year}`}>
              <rect x={xAt(i) - 22} y={PY - 6} width="44" height={H - 34 - PY + 6} rx="6" fill="var(--border)" opacity="0.5" />
              <text x={xAt(i)} y={H / 2} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">Not</text>
              <text x={xAt(i)} y={H / 2 + 13} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">recorded</text>
            </g>
          ))}
          {seg((r) => r.t, TONE.baby)}{seg((r) => r.T, TONE.adult)}
          {dots((r) => r.t, TONE.baby)}{dots((r) => r.T, TONE.adult)}
          {rows.map((r, i) => <text key={`x-${r.year}`} x={xAt(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{r.year}</text>)}
        </svg>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: TONE.baby }} />dmft, baby teeth</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: TONE.adult }} />DMFT, adult teeth</span>
        </div>
        <p className="text-xs text-muted-foreground">Baby teeth are shed as the child grows, so dmft can fall without the child improving. Read the two lines together.</p>
      </div>

      {/* Years-across grid */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-3.5">
        <h3 className="text-[13px] font-bold">Year by year</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-card" />
                {rows.map((r) => (
                  <th key={r.year} className="min-w-[7rem] px-2 py-1.5 text-center text-xs font-bold">
                    {r.year}
                    <div className="font-medium text-muted-foreground">{[r.grade, r.age != null ? `${r.age} y` : ''].filter(Boolean).join(', ')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group('Baby teeth')}
              {count('d decayed', (r) => r.d)}{count('m missing', (r) => r.m)}{count('f filled', (r) => r.f)}{count('x extraction', (r) => r.x)}{count('dmft', (r) => r.t, false, true)}
              {group('Adult teeth')}
              {count('D decayed', (r) => r.D)}{count('M missing', (r) => r.M)}{count('F filled', (r) => r.F)}{count('X extraction', (r) => r.X)}{count('DMFT', (r) => r.T, false, true)}
              {group('That year')}
              {text('Confirmed risk', (r) => { const l = riskOf(r); return l ? <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${PILL[l]}`}>{l}</span> : <span className="text-muted-foreground">None yet</span>; })}
              {text('Caries free teeth', (r) => r.free ?? 'Not recorded')}
              {text('Treatments recorded', (r) => r.treatments)}
              {text('Oral conditions', (r) => r.conditions.join(', ') || 'None')}
              {text('Orally Fit Child', (r) => yn(r.ofc))}
              {group('Teeth and the DOH form')}
              {text('Teeth with a finding', (r) => r.teeth.join(', ') || 'None')}
              {text('Caries experience', (r) => yn(r.t + r.T > 0))}
              {text('In baby teeth', (r) => yn(r.t > 0))}
              {text('In adult teeth', (r) => yn(r.T > 0))}
              {text('Active caries', (r) => yn(r.d + r.D > 0))}
            </tbody>
          </table>
        </div>
        {rows.some((r) => !r.recorded) && <p className="text-xs text-muted-foreground">The hatched column is a school year with no charting. It is left blank, not zero.</p>}
      </div>

      <details className="rounded-xl border border-border bg-card px-3.5 py-2">
        <summary className="cursor-pointer text-[13px] font-bold">How to read this</summary>
        <p className="pt-2 text-xs text-muted-foreground">Lowercase d m f x are baby teeth; capital D M F X are adult teeth. d = decayed, m = missing from decay, f = filled, x = extraction. dmft and DMFT are the sums. Experience means decayed, missing or filled, so a treated tooth still counts; active means decayed now. A year with no charting is shown as not recorded, never as zero.</p>
      </details>
    </div>
  );
}
