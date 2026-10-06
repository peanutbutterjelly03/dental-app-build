import { useCallback, useEffect, useState, type RefObject } from 'react';

// Shared by the wide report grids (the OCR grid's pattern): grab-and-drag scrolling with the mouse, and step
// buttons that move about a screen of columns past a frozen first column. The scroll bars themselves are hidden
// by the caller (`no-scrollbar`), so the buttons also tell the reader whether there is more to the left / right.
export function useGridScroll(ref: RefObject<HTMLElement | null>, pinnedSelector: string, deps: unknown[] = []) {
  const [edge, setEdge] = useState({ left: false, right: true, pinned: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({
      left: el.scrollLeft > 2,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 2,
      pinned: (el.querySelector(pinnedSelector) as HTMLElement | null)?.offsetWidth ?? 0,
    });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);

    // Mouse only; touch already scrolls natively.
    let down = false, moved = false, x0 = 0, y0 = 0, sl = 0, st = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch') return;
      down = true; moved = false; x0 = e.clientX; y0 = e.clientY; sl = el.scrollLeft; st = el.scrollTop;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
      el.scrollLeft = sl - dx;
      el.scrollTop = st - dy;
    };
    const end = () => { down = false; el.style.cursor = ''; el.style.userSelect = ''; };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const step = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const pinned = (el.querySelector(pinnedSelector) as HTMLElement | null)?.offsetWidth ?? 0;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth - pinned - 48), behavior: 'smooth' });
  }, [ref, pinnedSelector]);

  return { edge, step };
}
