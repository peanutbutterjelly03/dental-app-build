// The ‹ › tabs on the edges of a wide grid (the OCR grid's step buttons). By default the ‹ sits just right of the
// frozen columns. Place inside a `relative` box that holds the scroller; they are hidden on paper and sit outside the scroller, so a PDF capture never includes them.
export const GridEdgeButtons = ({ edge, onStep, yellow = false, leftInFirstColumn = false }: {
  edge: { left: boolean; right: boolean; pinned?: number };
  onStep: (dir: 1 | -1) => void;
  /** The Program Report's yellow tabs. */
  yellow?: boolean;
  /** Put the ‹ at the very left, inside the frozen first column, instead of just after the frozen columns. */
  leftInFirstColumn?: boolean;
}) => {
  const base = `print:hidden absolute top-1/2 z-40 grid h-[2.875rem] w-5 -translate-y-1/2 place-items-center ${yellow ? 'bg-[#FFC000] text-black' : 'bg-primary text-white'} text-base font-bold leading-none opacity-90 shadow-md hover:opacity-100 disabled:cursor-default disabled:opacity-30`;
  return (
    <>
      <button type="button" aria-label="Show previous columns" title="Show previous columns" disabled={!edge.left} onClick={() => onStep(-1)}
        style={{ left: leftInFirstColumn ? 1 : (edge.pinned ?? 0) + 1 }} className={`${base} rounded-r-[0.5625rem]`}>‹</button>
      <button type="button" aria-label="Show next columns" title="Show next columns" disabled={!edge.right} onClick={() => onStep(1)}
        className={`${base} right-px rounded-l-[0.5625rem]`}>›</button>
    </>
  );
};
