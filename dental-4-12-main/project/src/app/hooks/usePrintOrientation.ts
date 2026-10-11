import { useEffect } from 'react';

/** Paper the forms are actually printed on.
 *
 *  ⚠ LONG_BOND is the Philippine office standard (8.5 × 13 in, "long bond" /
 *  Folio / F4) and is what DOH field forms are run on. The filed Target Client
 *  List sample scans at a 1.50 width:height ratio, which is Folio (1.53) and
 *  not A4 (1.41) — the sheet edges are cropped out of that scan, so this is
 *  corroboration, not proof.
 *
 *  If the clinic's printer is loaded with A4, change the constant a form
 *  passes; nothing else has to move. */
export const PAPER = {
  LONG_BOND: '8.5in 13in',
  A4: 'A4',
} as const;

/**
 * Sets the PAPER for whichever form is on screen.
 *
 * ⚠ Why a hook and not CSS. `@page` cannot be selected by a class or an
 * ancestor — it is document-level — so the one static rule in index.css applied
 * to every printable in the app. That rule said `size: landscape`, which is
 * right for the wide DOH tables and wrong for the portrait ones: the IPTR and
 * the consent form were being laid on a landscape sheet with half of it blank.
 *
 * Only one printable report is mounted at a time (the report tabs render one
 * panel), so the mounted form owning the rule is accurate. The rule is removed
 * on unmount, falling back to index.css's default.
 *
 * `margin: 6mm` is deliberate — about the minimum most office printers can
 * manage. A DOH form is dense and every millimetre of the sheet is form.
 */
export function usePrintOrientation(
  orientation: 'portrait' | 'landscape',
  paper: string = PAPER.LONG_BOND,
) {
  useEffect(() => {
    const el = document.createElement('style');
    el.setAttribute('data-print-page', `${paper} ${orientation}`);
    el.textContent = `@media print { @page { size: ${paper} ${orientation}; margin: 6mm; } }`;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [orientation, paper]);
}
