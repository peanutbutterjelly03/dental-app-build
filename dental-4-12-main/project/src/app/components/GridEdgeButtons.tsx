// The ‹ › tabs on the edges of a wide grid (the OCR grid's step buttons). Place inside a `relative` box that
// holds the scroller; they are hidden on paper and sit outside the scroller, so a PDF capture never includes them.
export const GridEdgeButtons = ({ edge, onStep }: { edge: { left: boolean; right: boolean }; onStep: (dir: 1 | -1) => void }) => {
  const base = 'print:hidden absolute top-1/2 z-40 grid h-[2.875rem] w-5 -translate-y-1/2 place-items-center bg-primary text-base font-bold leading-none text-white opacity-90 shadow-md hover:opacity-100 disabled:cursor-default disabled:opacity-30';
  return (
    <>
      <button type="button" aria-label="Show previous columns" title="Show previous columns" disabled={!edge.left} onClick={() => onStep(-1)}
        className={`${base} left-px rounded-r-[0.5625rem]`}>‹</button>
      <button type="button" aria-label="Show next columns" title="Show next columns" disabled={!edge.right} onClick={() => onStep(1)}
        className={`${base} right-px rounded-l-[0.5625rem]`}>›</button>
    </>
  );
};
