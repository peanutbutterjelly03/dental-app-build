import { Fragment, useEffect, useRef, useState } from 'react';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import { Calendar, CalendarDays, CalendarRange, Clock } from 'lucide-react';
import { RangePicker } from './RangePicker';
import { downloadBlob } from '../utils/exportCsv';
import { formatDate, toLocalDateString } from '../utils/localDate';
import { PanelShell, PanelRow, GroupBox, Underlined, PeriodSwitch, fieldInputClass, ExportMenu, BOX_W } from './ReportControls';
import { useFhsisData, FHSIS_BANDS, type FhsisBandKey, type Measure } from '../hooks/useFhsisData';
import { buildDohReportPdf } from '../utils/exportPdf';
import { buildSheetsXlsx } from '../utils/exportXlsx';
import { usePreviewModal } from '../hooks/usePreviewModal';
import { PreviewModal } from './PreviewModal';
import { SkeletonTable } from './Skeleton';
import { useReportLayout } from '../hooks/useReportLayout';
import { cellText, layoutColumns, layoutRowGroups, layoutRows, showAll, type LCol, type LRow } from '../../../shared/reportLayout';
import { ReportLayoutMenu } from './ReportLayoutMenu';
// Section band: same look as the DOH Consolidated section rows (light blue fill, bold uppercase navy text).
const FORM_SECTION_BAND = 'bg-blue-50 text-blue-900';

// ─── FHSIS · SECTION D. ORAL HEALTH CARE SERVICES ────────────────────────────
// Transcribed from the "FHSIS" sheet of the workbook the user supplied
// (TCLForm2andFHSISReport.xlsx). That workbook carries TWO variants of this
// form: one headed "Health Center:" and one headed "School:". This is the
// SCHOOL one — the level Floral is scoped to. The health-centre variant
// consolidates sources Floral does not hold and is a separate report.
//
// The form is two mirrored halves: FIRST VISIT on the left, COMPLETED 2 VISITS
// on the right, each broken down by age band and sex. That maps directly onto
// the two-visit RPC module, so unlike the Program Report's Services Rendered
// rows, these numbers are REAL — counted from PREVENTIVE_CARE_RECORD.
//
// WHAT IS DELIBERATELY BLANK (CLAUDE.md, NOTHING COSMETIC — the form keeps all
// its rows, and a blank cell on a DOH form is meaningful):
//
//  * The `a` (facility-based) and `b` (non-facility-based) sub-rows, WHERE THE
//    FLAG IS UNRECORDED. Sprint 81 added PREVENTIVE_CARE_RECORD.facility_based
//    and a way to set it when recording a visit, so these rows now carry real
//    counts for visits recorded since. They default to NULL, though, so every
//    visit created before that has no answer: a cell with nothing flagged still
//    renders "—" rather than "0", because "0" claims nobody had facility-based
//    care where "—" says it was not recorded. When a cell has SOME flagged
//    visits and some not, the sub-rows show the real figures and the Remarks
//    column states how many are unclassified — so `a + b` falling short of the
//    total reads as missing data, not as an arithmetic error on a filed form.
//    Splitting the total on an assumption ("school screening must be
//    non-facility") would still be inventing a number, and is still not done.
//  * The Pregnant Women block. No pregnancy is recorded anywhere in the
//    schema, the same limitation the Oral Health Program Report hits.
//
// Age bands ARE all computed, including Infants and Seniors: a birthday is
// recorded, so those cells are genuine counts that happen to be 0 at a school,
// not fabrications. A true 0 and an unfillable cell are different claims and
// the form shows them differently.

const MEASURES: { key: Measure; heading: string; caption: (band: string) => string }[] = [
  {
    key: 'first',
    heading: 'FIRST VISIT TO AN ORAL HEALTH CARE PROFESSIONAL',
    caption: (b) => `${b} who had their 1st visit to an oral health care professional within a year`,
  },
  {
    key: 'completed',
    heading: 'COMPLETED 2 VISITS',
    caption: (b) => `${b} who completed 2 visits to an oral health care professional within a year`,
  },
];

/** Pregnant-women rows are on the printed form and have no source. */
const PREGNANT_AGE_GROUPS = ['10-14', '15-19', '20-49'] as const;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINALS = ['1st', '2nd', '3rd', '4th'];

// The workbook has 24 FHSIS sheets: 12 months, 4 quarters, 2 semi-annual and
// the Annual. A longer period is the sum of its months (shared/fhsis.ts).
type PeriodKind = 'range' | 'month' | 'quarter' | 'half' | 'year';
const pad = (n: number) => String(n).padStart(2, '0');

/** `pick` is the month (1-12), quarter (1-4) or half (1-2); ignored for a year. */
function describePeriod(kind: PeriodKind, pick: number, year: number, rangeStart: string, rangeEnd: string) {
  if (kind === 'range') {
    const label = rangeStart === rangeEnd ? formatDate(rangeStart) : `${formatDate(rangeStart)} to ${formatDate(rangeEnd)}`;
    return { key: `${rangeStart}..${rangeEnd}`, short: label, printed: label.toUpperCase() };
  }
  const first = kind === 'month' ? pick : kind === 'quarter' ? (pick - 1) * 3 + 1 : kind === 'half' ? (pick - 1) * 6 + 1 : 1;
  const last = kind === 'month' ? pick : kind === 'quarter' ? first + 2 : kind === 'half' ? first + 5 : 12;
  const key = first === last ? `${year}-${pad(first)}` : `${year}-${pad(first)}..${year}-${pad(last)}`;
  const short = first === last ? `${MONTH_NAMES[first - 1]} ${year}` : `${MONTH_NAMES[first - 1].slice(0, 3)} to ${MONTH_NAMES[last - 1].slice(0, 3)} ${year}`;
  // Printed in the form's "Month:" slot, worded like the workbook's sheet names.
  const printed = kind === 'month' ? `${MONTH_NAMES[pick - 1].toUpperCase()} ${year}`
    : kind === 'quarter' ? `${ORDINALS[pick - 1].toUpperCase()} QUARTER ${year}`
    : kind === 'half' ? `${ORDINALS[pick - 1].toUpperCase()} SEMI-ANNUAL ${year}`
    : `ANNUAL ${year}`;
  return { key, short, printed };
}

export const FhsisReport = ({ schoolName }: { schoolName: string }) => {
  // → A wide age-bracket × sex grid, like the other DOH tables.
  usePrintOrientation('landscape');
  const now = new Date();
  const [kind, setKind] = useState<PeriodKind>('month');
  const [pick, setPick] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rangeStart, setRangeStart] = useState(() => toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [rangeEnd, setRangeEnd] = useState(() => toLocalDateString(now));
  const { key: month, short: periodShort, printed: periodPrinted } = describePeriod(kind, pick, year, rangeStart, rangeEnd);
  const { counts, loading, error } = useFhsisData(month, schoolName);
  useEffect(() => {
    const els = [rowTitleRef.current, rowH1Ref.current, rowH2Ref.current];
    if (els.some((e) => !e)) return;
    const [a, b, c] = els as HTMLTableRowElement[];
    const measure = () => setRowH({ r0: a.offsetHeight, r1: b.offsetHeight, r2: c.offsetHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    els.forEach((e) => ro.observe(e as Element));
    return () => ro.disconnect();
  }, [loading, error]);
  const printableRef = useRef<HTMLDivElement>(null);
  const layoutApi = useReportLayout('fhsis');
  const layout = layoutApi.layout;
  // Heights of the pinned rows (title, two header rows), so each sticks right under the one above.
  const rowTitleRef = useRef<HTMLTableRowElement>(null);
  const rowH1Ref = useRef<HTMLTableRowElement>(null);
  const rowH2Ref = useRef<HTMLTableRowElement>(null);
  const [rowH, setRowH] = useState({ r0: 34, r1: 30, r2: 26 });
  const { preview, building, previewPdf, closePreview, confirmDownload } = usePreviewModal();
  const [xlsxBusy, setXlsxBusy] = useState(false);

  /** Filename stamped with school + month, so downloads are distinguishable
   *  once several months are filed. */
  const baseName = `FHSIS-SectionD_${(schoolName || 'All-Schools').replace(/[^\w]+/g, '-')}_${month.replace('..', '_to_')}`;

  const onPdf = () => {
    if (!printableRef.current) return;
    const el = printableRef.current;
    previewPdf('FHSIS Section D', `${baseName}.pdf`, () => buildDohReportPdf(el));
  };

  // The Excel export writes the SAME cells the screen shows, blanks included, so
  // the downloaded workbook makes the identical claims as the report. Writing
  // 0 where the screen says "—" would quietly turn "not recorded" into
  // "examined none" the moment it left the app.
  // Excel downloads straight away (user-approved Print menu, 2026-10-08); the
  // PDF is the one that opens a preview first.
  const onXlsx = async () => {
    setXlsxBusy(true);
    try {
      // Same lists the screen renders, so hidden items stay out and added/renamed ones come through.
      const mainCols = (['L', 'R'] as const).flatMap((h) => [halves[h].ind, ...halves[h].data]);
      const cellFor = (h: 'L' | 'R', pairKey: string, rowAdded: boolean, r: FRow | undefined, measure: Measure, label: string, blanked: boolean) => {
        const { ind, data } = halves[h];
        const empty = blanked || (!rowAdded && !r);
        const indText = empty ? '' : rowAdded ? (h === 'L' ? label : cellText(layout, pairKey, ind.key)) : label;
        return [indText, ...data.map((c) => {
          if (empty) return '';
          if (rowAdded || c.added) return cellText(layout, pairKey, c.key);
          return String(calc(r, measure, c.key.slice(2) as 'M' | 'F' | 'T' | 'R').v);
        })];
      };
      const mainRows: string[][] = [
        mainCols.map((c) => (c.group ? `${c.group}: ${c.label}` : c.label)),
        ...laidPairs.map((lr) => {
          const i = Number(lr.key.slice(1));
          const right = lr.added ? undefined : laidRight.get(`p${i}R`);
          return [
            ...cellFor('L', lr.key, !!lr.added, lr.added ? undefined : leftRows[i], 'first', lr.label, false),
            ...cellFor('R', lr.key, !!lr.added, lr.added ? undefined : rightRows[i], 'completed', right?.label ?? '', !lr.added && !right),
          ];
        }),
      ];
      const pregHead = ['INDICATORS', 'Age Group: 10-14', 'Age Group: 15-19', 'Age Group: 20-49', 'Total', 'Remarks'];
      const pregRows: string[][] = [
        [...pregHead, ...pregHead],
        ...laidPreg.map((lr) => {
          const i = Number(lr.key.slice(1));
          const right = lr.added ? undefined : laidRight.get(`g${i}R`);
          const half = (pre: 'PL' | 'PR', label: string, blanked: boolean) => [
            blanked ? '' : (lr.added && pre === 'PR' ? cellText(layout, lr.key, `${pre}:ind`) : label),
            ...[0, 1, 2, 3, 4].map((k) => (lr.added ? cellText(layout, lr.key, `${pre}:${k}`) : '')),
          ];
          return [...half('PL', lr.label, false), ...half('PR', right?.label ?? '', !lr.added && !right)];
        }),
      ];
      const sheetCols = (n: number, title: string) => Array.from({ length: n }, (_, i) => ({
        label: i === 0 ? title : '', value: (r: string[]) => r[i] ?? '',
      }));
      const title = `Indicators. School: ${schoolName || 'All schools'}. Month: ${periodPrinted}`;
      const blob = await buildSheetsXlsx([
        { name: 'FHSIS Section D', rows: mainRows, columns: sheetCols(mainCols.length, title) },
        { name: 'Pregnant women', rows: pregRows, columns: sheetCols(12, 'PREGNANT WOMEN (by age group)') },
      ]);
      downloadBlob(blob, `${baseName}.xlsx`);
    } finally {
      setXlsxBusy(false);
    }
  };

  const panel = (
    <PanelShell>
      <PanelRow>
        <GroupBox title="Time period" icon={Clock} className={BOX_W}>
          <PeriodSwitch<PeriodKind> name="Time period" value={kind}
            options={[{ v: 'range', kind: 'range' }, { v: 'month', kind: 'month' }, { v: 'quarter', kind: 'quarter' }, { v: 'half', kind: 'half' }, { v: 'year', kind: 'year' }]}
            onChange={(k) => { setKind(k); setPick(k === 'month' ? now.getMonth() + 1 : 1); }} />
        </GroupBox>
        <GroupBox title="Dates" icon={CalendarDays} className="w-full lg:w-auto lg:px-6">
          {kind === 'range' ? (
            <RangePicker start={rangeStart} end={rangeEnd} onChange={(a, b) => { setRangeStart(a); setRangeEnd(b); }} />
          ) : (
          <div className="flex w-full gap-5 lg:w-auto lg:gap-6">
            {kind !== 'year' && (
              <Underlined label={kind === 'month' ? 'Month' : kind === 'quarter' ? 'Quarter' : 'Half'} icon={Calendar} chevron>
                <select aria-label="Period" value={pick} onChange={(e) => setPick(Number(e.target.value))} className={`${fieldInputClass} !pr-5`}>
                  {kind === 'month' && MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>))}
                  {kind === 'quarter' && [1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>{ORDINALS[q - 1]} Quarter ({MONTH_NAMES[(q - 1) * 3].slice(0, 3)} to {MONTH_NAMES[q * 3 - 1].slice(0, 3)})</option>))}
                  {kind === 'half' && [1, 2].map((h) => (
                    <option key={h} value={h}>{ORDINALS[h - 1]} Semi-Annual ({h === 1 ? 'Jan to Jun' : 'Jul to Dec'})</option>))}
                </select>
              </Underlined>
            )}
            <Underlined label="Year" icon={Calendar} chevron>
              <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${fieldInputClass} !pr-5`}>
                {Array.from(new Set([...[3, 2, 1, 0].map((i) => now.getFullYear() - i), year])).sort().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Underlined>
          </div>
          )}
        </GroupBox>
        <div className="flex self-start lg:ml-auto">
          {/* Print / PDF (preview first) / Excel (downloads). */}
          <ExportMenu busy={xlsxBusy || (building && preview.kind === 'pdf')} onPrint={() => window.print()} onPdf={onPdf} onExcel={() => { void onXlsx(); }}
            excelDisabledReason={loading || error ? 'Loading' : undefined} pdfDisabledReason={loading || error ? 'Loading' : undefined} />
        </div>
      </PanelRow>
      <p className="sr-only" aria-live="polite">Showing {periodShort}, {schoolName || 'all schools'}</p>
    </PanelShell>
  );

  if (error) {
    return <div className="space-y-4">{panel}<div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div></div>;
  }
  if (loading) return <div className="space-y-4">{panel}<SkeletonTable rows={12} /></div>;

  const TD = 'border-r border-b border-gray-300 px-2 py-1.5';
  const NO_FACILITY_FIELD = 'Not recorded — no visit counted here has its facility-based flag set. The flag is optional when recording an RPC visit, and visits recorded before it existed have no value.';
  const NO_PREGNANCY = 'Not recorded by this system — no pregnancy field exists in the schema.';

  // The form's two halves, copied from the FHSIS sheet of 2026_Form_2_with_FHSIS:
  // FIRST VISIT on the left, COMPLETED 2 VISITS on the right, side by side. The
  // left half starts with the infants row; the right half has none. Numbering is
  // the form's own: infants and children 1-4 both print "1.".
  type FRow = { band: FhsisBandKey; kind: 'main' | 'sub'; n: number; suffix?: 'a' | 'b'; label: string };
  const buildSide = (measure: Measure): FRow[] => {
    const verb = measure === 'first' ? 'had their 1st visit' : 'completed 2 visits';
    const rows: FRow[] = [];
    FHSIS_BANDS.forEach((band, idx) => {
      if (band.key === 'infants') {
        if (measure === 'first') rows.push({ band: band.key, kind: 'main', n: 1, label: '1. Infants 0-11 months old who had their first dental visit' });
        return;
      }
      rows.push({ band: band.key as FhsisBandKey, kind: 'main', n: idx, label: `${idx}. ${band.label} who ${verb} to an oral health care professional within a year` });
      for (const suffix of ['a', 'b'] as const) {
        rows.push({
          band: band.key as FhsisBandKey, kind: 'sub', n: idx, suffix,
          label: `${idx}${suffix}. ${band.label} who ${verb} to a ${suffix === 'a' ? 'facility-based' : 'non-facility-based'} oral health care professional within a year`,
        });
      }
    });
    return rows;
  };
  const leftRows = buildSide('first');
  const rightRows = buildSide('completed');
  const pairs = Math.max(leftRows.length, rightRows.length);

  // ── Layout: columns per half, rows as pairs (a left row and the right row beside it) ──
  // Column keys are `L:`/`R:` + M | F | T | R (Male, Female, Total, Remarks); the label columns are locked.
  const baseCols: LCol[] = ['L', 'R'].flatMap((h) => [
    { key: `${h}:ind`, label: 'INDICATORS', locked: true },
    { key: `${h}:M`, label: 'Male', group: 'Sex' },
    { key: `${h}:F`, label: 'Female', group: 'Sex' },
    { key: `${h}:T`, label: 'Total' },
    { key: `${h}:R`, label: 'Remarks' },
  ]);
  // A column added from the menu stands alone (one cell, spanning both header rows).
  const laidCols = layoutColumns(baseCols, layout).map((c) => (c.added ? { ...c, group: undefined } : c));
  const halves: Record<'L' | 'R', { ind: LCol; data: LCol[] }> = { L: { ind: baseCols[0], data: [] }, R: { ind: baseCols[5], data: [] } };
  {
    let side: 'L' | 'R' = 'L';
    for (const c of laidCols) {
      if (c.key === 'R:ind') { side = 'R'; halves.R.ind = c; continue; }
      if (c.key === 'L:ind') { halves.L.ind = c; continue; }
      halves[side].data.push(c);
    }
  }
  const widthOf = (c: LCol) => (c.key.endsWith(':R') ? 2 : 1);
  const halfCells = (h: 'L' | 'R') => 1 + halves[h].data.reduce((n, c) => n + widthOf(c), 0);
  const totalCells = halfCells('L') + halfCells('R');

  const pairBase: LRow[] = Array.from({ length: pairs }, (_, i) => ({ key: `p${i}`, label: leftRows[i]?.label ?? '' }));
  const PREG = ['', 'a', 'b'] as const;
  const pregLabel = (measure: Measure, suffix: '' | 'a' | 'b') => {
    const verb = measure === 'first' ? 'had their 1st visit' : 'completed 2 visits';
    const kindText = suffix === 'a' ? ' to a facility-based oral health care professional' : suffix === 'b' ? ' to a non-facility-based oral health care professional' : ' to an oral health care professional';
    return `6${suffix}. Pregnant Women who ${verb}${kindText} within a year`;
  };
  const pregBase: LRow[] = PREG.map((sfx, i) => ({ key: `g${i}`, label: pregLabel('first', sfx) }));
  const [laidPairs, laidPreg] = layoutRowGroups([pairBase, pregBase], layout);
  // The right half's own labels: renamable and hideable on their own, anchored to their pair.
  const rightBase: LRow[] = [
    ...rightRows.map((r, i) => ({ key: `p${i}R`, label: r.label, anchor: `p${i}` })),
    ...PREG.map((sfx, i) => ({ key: `g${i}R`, label: pregLabel('completed', sfx), anchor: `g${i}` })),
  ];
  const laidRight = new Map(layoutRows(rightBase, { ...layout, added_rows: [] }).map((r) => [r.key, r]));
  const hiddenRowCount = layout.hidden_rows.length;
  const hiddenColCount = layout.hidden_cols.length;

  /** The text of one computed cell of a half, or '' where the form leaves it empty. */
  const calc = (r: FRow | undefined, measure: Measure, col: 'M' | 'F' | 'T' | 'R'): { v: string | number; title?: string } => {
    if (!r) return { v: '' };
    const c = counts[r.band][measure];
    if (r.kind === 'main') {
      return col === 'M' ? { v: c.male } : col === 'F' ? { v: c.female } : col === 'T' ? { v: c.male + c.female } : { v: '' };
    }
    const sub = r.suffix === 'a' ? c.facility : c.nonFacility;
    const unrecorded = c.unrecorded.male + c.unrecorded.female;
    // A cell with nothing flagged stays blank (not recorded), never 0: "0" would
    // claim nobody had facility-based care.
    const anyFlagged = c.facility.male + c.facility.female + c.nonFacility.male + c.nonFacility.female > 0;
    if (col === 'R') return { v: !anyFlagged ? '' : unrecorded > 0 ? `${unrecorded} visit${unrecorded === 1 ? '' : 's'} not classified` : '' };
    if (!anyFlagged) return { v: '', title: NO_FACILITY_FIELD };
    return col === 'M' ? { v: sub.male } : col === 'F' ? { v: sub.female } : { v: sub.male + sub.female };
  };

  const hd = 'border-r border-b border-gray-300 bg-gray-200 px-2 py-1.5 text-center font-semibold';
  const hdInd = 'border-r border-b border-gray-300 bg-gray-200 px-2 py-2 text-left align-bottom text-[11px] font-semibold';

  /** One half of a body row: its label cell, then a cell per visible column. */
  const halfRow = (h: 'L' | 'R', pairKey: string, rowAdded: boolean, r: FRow | undefined, measure: Measure, label: string, blanked: boolean) => {
    const { ind, data } = halves[h];
    const rk = h === 'R' && !rowAdded ? `${pairKey}R` : pairKey;
    const sub = r?.kind === 'sub';
    const empty = blanked || (!rowAdded && !r);
    const labelText = rowAdded ? (h === 'L' ? label : cellText(layout, pairKey, ind.key)) : label;
    return (
      <>
        <td data-ck={ind.key} data-rk={rk} className={`${TD} ${sub ? 'pl-6 text-muted-foreground' : ''}`}>{empty ? '' : labelText}</td>
        {data.map((c) => {
          if (empty) return <td key={c.key} className={TD} colSpan={widthOf(c)} />;
          if (rowAdded || c.added) {
            return <td key={c.key} data-ck={c.key} data-rk={rk} colSpan={widthOf(c)} className={`${TD} text-center`}>{cellText(layout, pairKey, c.key)}</td>;
          }
          const kind = c.key.slice(2) as 'M' | 'F' | 'T' | 'R';
          const out = calc(r, measure, kind);
          return kind === 'R'
            ? <td key={c.key} data-ck={c.key} data-rk={rk} colSpan={2} className={`${TD} text-[11px]`}>{out.v}</td>
            : <td key={c.key} data-ck={c.key} data-rk={rk} className={`${TD} text-center tabular-nums`} title={out.title}>{out.v}</td>;
        })}
      </>
    );
  };

  /** A header half: label cell, then the Sex group (Male/Female) and the standalone columns. */
  const headHalf = (h: 'L' | 'R') => {
    const { ind, data } = halves[h];
    const out: React.ReactNode[] = [<th key={ind.key} data-ck={ind.key} rowSpan={2} className={hdInd}>{ind.label}</th>];
    for (let i = 0; i < data.length;) {
      const c = data[i];
      if (c.group === 'Sex') {
        let j = i;
        while (j < data.length && data[j].group === 'Sex') j++;
        const run = data.slice(i, j);
        out.push(<th key={`sex-${c.key}`} colSpan={run.length} data-cg={run.map((x) => x.key).join(',')} data-cgl="Sex" className={hd}>Sex</th>);
        i = j;
      } else {
        out.push(<th key={c.key} data-ck={c.key} rowSpan={2} colSpan={widthOf(c)} className={hd}>{c.label}</th>);
        i++;
      }
    }
    return out;
  };

  // Rows the menu can rename/hide beside the pair rows (the right half's own labels).
  const rightExtras = [...laidRight.values()];

  return (
    <div className="space-y-8">
      {/* Controls: see ReportControls.tsx. */}
      {panel}

      {/* ref is on the OUTER box so the title and the sheet are captured WITH the
          table. html2canvas clips to the ref'd element's own rendered box, so a
          banner placed outside it shows on screen and is silently missing from the PDF. */}
      <div className="form-print relative -mb-4 overflow-hidden rounded-t-xl border border-[#A9BDE6] bg-card md:-mb-8">
      <div
        ref={printableRef}
        className="no-scrollbar max-h-[max(320px,calc(100vh_-_94px))] overflow-auto rounded-t-xl print:max-h-none [&_tr>:last-child]:border-r-0"
        style={{ ['--fh-r1' as string]: `${rowH.r0}px`, ['--fh-r2' as string]: `${rowH.r0 + rowH.r1}px`, ['--fh-r3' as string]: `${rowH.r0 + rowH.r1 + rowH.r2}px` }}
      >
        {hiddenRowCount + hiddenColCount > 0 && (
          <p className="border-b border-gray-300 px-3 py-2 text-[11px] font-semibold text-destructive">
            SHORTENED FORM: not the complete FHSIS form. {hiddenRowCount} row(s) and {hiddenColCount} column(s) hidden.
          </p>
        )}
        <ReportLayoutMenu api={layoutApi} columns={laidCols} rows={[...laidPairs, ...laidPreg]} extraRows={rightExtras}>
        <table className="w-full min-w-[1100px] text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr ref={rowTitleRef} className="[&>th]:sticky [&>th]:top-0 [&>th]:z-20">
              <th colSpan={totalCells} className="border-b border-gray-300 bg-[#CFDDF6] px-3 py-2 text-center text-[12px] font-bold uppercase tracking-wide text-[#273A78]">
                Oral Health Care Services
              </th>
            </tr>
            <tr ref={rowH1Ref} className="[&>th]:sticky [&>th]:top-[var(--fh-r1)] [&>th]:z-20">
              {headHalf('L')}
              {headHalf('R')}
            </tr>
            <tr ref={rowH2Ref} className="[&>th]:sticky [&>th]:top-[var(--fh-r2)] [&>th]:z-20">
              {(['L', 'R'] as const).map((h) => (
                <Fragment key={h}>
                  {halves[h].data.filter((c) => c.group === 'Sex').map((c) => <th key={c.key} data-ck={c.key} className={hd}>{c.label}</th>)}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className={`${FORM_SECTION_BAND} [&>td]:sticky [&>td]:top-[var(--fh-r3)] [&>td]:z-20`}>
              <td colSpan={totalCells} className={`border-b border-gray-300 px-3 py-1.5 font-bold uppercase tracking-wide ${FORM_SECTION_BAND}`}>
                FIRST VISIT TO AN ORAL HEALTH CARE PROFESSIONAL
              </td>
            </tr>
            {laidPairs.map((lr) => {
              const i = Number(lr.key.slice(1));
              const right = lr.added ? undefined : laidRight.get(`p${i}R`);
              return (
                <tr key={lr.key} data-rk={lr.key}>
                  {halfRow('L', lr.key, !!lr.added, lr.added ? undefined : leftRows[i], 'first', lr.label, false)}
                  {halfRow('R', lr.key, !!lr.added, lr.added ? undefined : rightRows[i], 'completed', right?.label ?? '', !lr.added && !right)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Pregnant women: on the form, no source in the system. Its own table, since its
            columns (age groups) differ from the block above. */}
        <table className="w-full min-w-[1100px] text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {[0, 1].map((i) => (
                <Fragment key={i}>
                  <th rowSpan={2} className={hdInd}>INDICATORS</th>
                  <th colSpan={3} className={hd}>Age Group</th>
                  <th rowSpan={2} className={hd}>Total</th>
                  <th rowSpan={2} className={hd}>Remarks</th>
                </Fragment>
              ))}
            </tr>
            <tr>
              {[0, 1].flatMap((i) => ['10-14', '15-19', '20-49'].map((g) => <th key={`pg${i}${g}`} className={hd}>{g}</th>))}
            </tr>
          </thead>
          <tbody>
            {laidPreg.map((lr) => {
              const i = Number(lr.key.slice(1));
              const right = lr.added ? undefined : laidRight.get(`g${i}R`);
              const half = (side: 'L' | 'R', label: string, blanked: boolean) => {
                const rk = side === 'R' && !lr.added ? `${lr.key}R` : lr.key;
                const pre = side === 'L' ? 'PL' : 'PR';
                return (
                  <>
                    <td data-ck={`${pre}:ind`} data-rk={rk} className={`${TD} ${i > 0 ? 'pl-6 text-muted-foreground' : ''}`}>{blanked ? '' : (lr.added && side === 'R' ? cellText(layout, lr.key, `${pre}:ind`) : label)}</td>
                    {[0, 1, 2, 3, 4].map((k) => (
                      <td key={k} data-ck={`${pre}:${k}`} data-rk={rk} className={TD} title={!lr.added && !blanked ? NO_PREGNANCY : undefined}>{lr.added ? cellText(layout, lr.key, `${pre}:${k}`) : ''}</td>
                    ))}
                  </>
                );
              };
              return (
                <tr key={lr.key} data-rk={lr.key}>
                  {half('L', lr.label, false)}
                  {half('R', right?.label ?? '', !lr.added && !right)}
                </tr>
              );
            })}
          </tbody>
        </table>
        </ReportLayoutMenu>
        {layoutApi.error && <p className="print-hide px-4 py-2 text-xs text-destructive">{layoutApi.error}</p>}
      </div>
      </div>
      <PreviewModal
        open={preview.open}
        kind={preview.kind}
        title={preview.title}
        url={preview.url}
        onClose={closePreview}
        onDownload={confirmDownload}
      />
    </div>
  );
};
