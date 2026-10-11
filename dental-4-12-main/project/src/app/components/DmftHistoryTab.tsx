import { computeDMFT, type ChartEntry } from '../utils/dentalChartCodes';
import type { IptrYearData } from '../hooks/useDentalChartData';

// The Dental Records tab — DMFT progression across a pupil's school years.
//
// Extracted from `DentalChart.tsx` in Sprint 162b, unchanged. It was the
// obvious first tab to lift: of the seven panels in that component this is the
// only one that reads NOTHING but `years` — no handlers, no local state, no
// callbacks — so the move needs one prop and can change no behaviour.
//
// The other six tabs are genuine seams too, but each shares mutable chart state
// with the host and will need its handlers threaded deliberately. This one is
// the pattern, not the precedent for rushing those.

export function DmftHistoryTab({ years }: { years: IptrYearData[] }) {
  const dmftByYear = years.map((y) => {
    // BUG-12: the latest charting that HAS records, not the latest charting.
    // `null` means nothing was charted that year and must print as "not
    // recorded" — a 0 here would claim the mouth was examined and found sound.
    const rows = y.dmftToothRecords;
    if (!rows) return { year: y.iptr.school_year, recorded: false as const };
    const chart: Record<number, ChartEntry> = {};
    for (const tr of rows) chart[tr.tooth_number] = { condition: tr.condition, treatment: tr.treatment_code ?? '' };
    return { year: y.iptr.school_year, recorded: true as const, ...computeDMFT(chart) };
  });
  /** Years that actually have a charting — the only ones the KPI tiles can speak
   *  for. The type predicate is load-bearing: a plain `.filter(r => r.recorded)`
   *  does not narrow the union, so the tiles below could not read `.T`. */
  const recorded = dmftByYear.filter(
    (r): r is Extract<typeof r, { recorded: true }> => r.recorded,
  );

  if (dmftByYear.length === 0) {
    return <div className="p-8 text-center text-muted-foreground text-sm">No records yet.</div>;
  }

  return (
    <div className="p-4 space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-foreground">DMFT Progression by School Year</h3>
        <p className="text-xs text-muted-foreground">Lowercase (d m f x · dmft) = primary / deciduous teeth; uppercase (D M F X · DMFT) = permanent teeth. A child with both present is in mixed dentition.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-border">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">School Year</th>
              {['d', 'm', 'f', 'x', 'dmft', 'D', 'M', 'F', 'X', 'DMFT'].map((h) => (
                <th key={h} className={`px-2 py-2 text-center text-xs font-medium ${h === 'dmft' || h === 'DMFT' ? 'bg-gray-100 font-bold text-foreground' : h === h.toLowerCase() ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dmftByYear.map((row, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? 'bg-card' : 'bg-gray-50/50'}>
                <td className="px-4 py-2 font-medium text-foreground text-xs">{row.year}</td>
                {row.recorded ? (
                  <>
                    <td className="px-2 py-2 text-center text-xs text-red-700">{row.d || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-slate-600">{row.m || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-blue-700">{row.f || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-orange-700">{row.x || ''}</td>
                    <td className="px-2 py-2 text-center text-xs font-bold text-foreground bg-gray-100">{row.t}</td>
                    <td className="px-2 py-2 text-center text-xs text-red-700">{row.D || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-slate-600">{row.M || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-blue-700">{row.F || ''}</td>
                    <td className="px-2 py-2 text-center text-xs text-orange-700">{row.X || ''}</td>
                    <td className="px-2 py-2 text-center text-xs font-bold text-foreground bg-gray-100">{row.T}</td>
                  </>
                ) : (
                  // BUG-12: no charting that year recorded a tooth. One spanned
                  // cell saying so, rather than ten zeroes that would read as
                  // "examined, nothing found".
                  <td colSpan={10} className="px-2 py-2 text-center text-xs italic text-muted-foreground">
                    Not recorded — no charting this school year
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          // BUG-12: every tile reads the RECORDED years only. Before this they
          // indexed the last row whatever it held, so a year with no charting
          // made "Latest DMFT" read 0 and the Trend read "Stable".
          { label: 'Latest dmft (primary)', value: recorded.length ? recorded[recorded.length - 1].t : '—', color: 'text-red-700 bg-red-50' },
          { label: 'Latest DMFT (permanent)', value: recorded.length ? recorded[recorded.length - 1].T : '—', color: 'text-blue-700 bg-blue-50' },
          // Counts the years with a charting, not the years on file — "tracked"
          // means measured, and a year with nothing charted was not.
          { label: 'Years tracked', value: recorded.length, color: 'text-foreground bg-gray-100' },
          // A trend needs 2+ RECORDED years; equal values are Stable, not Improving (DMFT is cumulative)
          { label: 'Trend', value: recorded.length < 2 ? '—' : recorded[recorded.length - 1].T > recorded[0].T ? '↑ Worsening' : recorded[recorded.length - 1].T < recorded[0].T ? '↓ Improving' : 'Stable', color: recorded.length >= 2 && recorded[recorded.length - 1].T > recorded[0].T ? 'text-red-700 bg-red-50' : recorded.length >= 2 && recorded[recorded.length - 1].T < recorded[0].T ? 'text-green-700 bg-green-50' : 'text-foreground bg-gray-100' },
        ].map((kpi, i) => (
          <div key={i} className={`rounded-lg p-3 ${kpi.color}`}>
            <div className="text-xl font-bold">{kpi.value}</div>
            <div className="text-xs mt-0.5 opacity-80">{kpi.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
