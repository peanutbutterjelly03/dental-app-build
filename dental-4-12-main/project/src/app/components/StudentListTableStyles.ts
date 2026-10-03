export const studentListTableStyles = {
  wrapper: 'bg-card rounded-xl border border-border overflow-hidden',
  scroller: 'overflow-x-auto',
  table: 'w-full text-sm',
  head: 'bg-gray-50 border-b border-border',
  headerCell: 'text-left px-4 py-3 font-semibold text-foreground',
  body: 'divide-y divide-gray-100',
  row: 'hover:bg-gray-50 transition-colors cursor-pointer',
  primaryCell: 'px-4 py-3 font-medium text-foreground',
  secondaryCell: 'px-4 py-3 text-muted-foreground',
  emptyCell: 'text-center py-12 text-muted-foreground',
  footer: 'px-4 py-3 border-t border-gray-100 text-sm text-muted-foreground',
} as const;
