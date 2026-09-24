// headerCell/footer match PatientList's own table exactly (2026-09-25,
// "apply this design for others for uniformity"): a gray-100 fill on each
// `<th>` (not on `<thead>` -- PatientList puts the fill there so a
// bounded-scroll table's sticky header keeps its background), uppercase
// tracked label text, and the same footer padding/border/background.
export const studentListTableStyles = {
  wrapper: 'bg-card rounded-xl border border-border overflow-hidden',
  scroller: 'overflow-x-auto',
  table: 'w-full text-sm',
  head: 'border-b border-border',
  headerCell: 'text-left px-4 py-3 bg-gray-100 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
  body: 'divide-y divide-gray-100',
  row: 'hover:bg-gray-50 transition-colors cursor-pointer',
  primaryCell: 'px-4 py-3 font-medium text-foreground',
  secondaryCell: 'px-4 py-3 text-muted-foreground',
  emptyCell: 'text-center py-12 text-muted-foreground',
  footer: 'px-5 py-4 sm:px-6 border-t border-border bg-card',
} as const;
