import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Shared list pagination ──────────────────────────────────────────────────
// Extracted from PatientList (Sprint 53) and applied to the other list screens,
// which rendered EVERY filtered row — invisible at demo scale, thousands of DOM
// rows at the Chapter 1 scale of ~8,000 students.
//
// This is CLIENT-side paging over an already-fetched array, deliberately.
// Server-side paging was investigated and rejected: these lists search by
// substring on the student's name, and names are encrypted with random IVs
// (Sprint 26), so the server cannot match them — a paginating server must also
// filter, and it cannot filter by name. See Open work 24.
//
// Page size is a user choice rather than a constant. The old comment agonised
// over "25, not 10"; a picker settles it, and a dentist scanning one section
// wants a different size than an aide checking a handful of rows.

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/** Slices `items` for the current page and keeps the page number honest.
 *  `resetKeys` are the FILTER INPUTS — pass the search box and dropdowns, never
 *  the derived list. Keying the reset on the list itself means a background
 *  refresh (Sprint 40) yanks the reader back to page 1 mid-read. */
export function usePagination<T>(items: T[], resetKeys: unknown[], initialPageSize: number = DEFAULT_PAGE_SIZE) {
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamped rather than trusted: filtering or deleting can shrink the list
  // under the current page, which would otherwise render an empty table.
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  useEffect(() => { setPage(1); }, resetKeys); // eslint-disable-line react-hooks/exhaustive-deps
  // Changing page size keeps you near the same records rather than dumping you
  // back to the top — going 25 → 50 on page 3 should not lose your place.
  const changePageSize = (next: number) => {
    const firstRow = (safePage - 1) * pageSize;
    setPageSize(next);
    setPage(Math.floor(firstRow / next) + 1);
  };

  return {
    paged,
    page: safePage,
    setPage,
    pageSize,
    changePageSize,
    pageCount,
    total: items.length,
    /** 1-based inclusive range of what is on screen, for the "1–50 of 134" label. */
    from: items.length === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, items.length),
  };
}

interface Props {
  page: number;
  pageCount: number;
  pageSize: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  /** What is being counted, e.g. "students" — appears in the range label. */
  noun?: string;
  /** Extra text after the range, e.g. "(filtered from 134)". */
  detail?: string;
}

// Matches PatientList's/RPCTracking's own inline footer exactly (2026-09-25,
// "apply this design for others for uniformity") -- every list screen using
// this shared component now renders the same "Showing X to Y of Z {noun} |
// Items per page [n]" line and the same pill Previous/Next controls, instead
// of each page hand-rolling a slightly different footer.
const navBtn =
  'flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-canvas ' +
  'disabled:opacity-40 disabled:hover:bg-transparent';

export const Pagination = ({
  page, pageCount, pageSize, from, to, total, onPage, onPageSize, noun = 'rows', detail,
}: Props) => (
  // Stacks below sm: per CLAUDE.md's three-device rule — this row is read on a
  // phone in the field, not only on a clinic PC.
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span>
        Showing <span className="font-semibold text-foreground">{from}</span> to{' '}
        <span className="font-semibold text-foreground">{to}</span> of{' '}
        <span className="font-semibold text-foreground">{total}</span> {noun}
        {detail ? ` ${detail}` : ''}
      </span>
      {/* Literal glyph, not a CSS-drawn bar (2026-09-25: user wants "like a
          normal |" -- thinner than any solid bar reads). */}
      <span aria-hidden="true" className="hidden text-3xl font-thin text-gray-300 sm:inline-block">|</span>
      <label htmlFor="page-size" className="whitespace-nowrap text-sm font-normal">Items per page</label>
      <select
        id="page-size"
        aria-label="Items per page"
        value={pageSize}
        onChange={(e) => onPageSize(Number(e.target.value))}
        className="rounded-full border border-border bg-canvas px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>

    {/* Hidden on a single page — controls that can never do anything are
        just noise. No First/Last: Previous/Next plus the "page / pageCount"
        badge is what PatientList settled on even at the ~8,000-student
        scale, so this stays the one pattern everywhere rather than a
        longer-list special case. */}
    {pageCount > 1 && (
      <div className="flex items-center gap-2">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} className={navBtn} aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <span className="rounded-full bg-primary-surface px-3 py-1.5 text-sm font-semibold text-primary tabular-nums">{page} / {pageCount}</span>
        <button onClick={() => onPage(Math.min(pageCount, page + 1))} disabled={page === pageCount} className={navBtn} aria-label="Next page">
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    )}
  </div>
);
