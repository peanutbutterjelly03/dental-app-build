import { useEffect, useRef, type ReactNode } from 'react';

// Shared modal shell (Sprint 23n / audit X1). Native <dialog>, so focus trap,
// Esc-to-close, and top-layer stacking come from the platform instead of five
// hand-rolled fixed-inset-0 overlays. Children carry their own header/body/
// footer JSX — this only owns the container, backdrop, and close behavior.
//
// Usage: {show && <Modal onClose={...}>…</Modal>} — mount to open.
// `closeDisabled` blocks Esc/backdrop while an operation is in flight.
interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class for the panel, e.g. 'max-w-md' | 'max-w-lg' */
  maxWidth?: string;
  /** When true, Esc and backdrop-click do nothing (e.g. mid-import) */
  closeDisabled?: boolean;
}

export const Modal = ({ onClose, children, maxWidth = 'max-w-md', closeDisabled = false }: ModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // scroll lock while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <dialog
      ref={ref}
      // Esc fires 'cancel'
      onCancel={(e) => {
        e.preventDefault();
        if (!closeDisabled) onClose();
      }}
      // click on the dialog element itself = backdrop (children cover the panel)
      onClick={(e) => {
        if (e.target === ref.current && !closeDisabled) onClose();
      }}
      // w-[calc(100%-2rem)] rather than w-full: a native <dialog> shown via
      // showModal() is only centered by the browser because its UA
      // stylesheet gives it `margin: auto` on every side — replacing that
      // with an explicit mx-* (tried once, wrongly) drops it to the left
      // edge, since a fixed margin isn't "centered", it's "offset". Capping
      // the WIDTH short of 100% instead guarantees a gutter on phones while
      // leaving auto-margin centering (m-auto) intact on every screen size.
      className={`w-[calc(100%-2rem)] ${maxWidth} bg-card rounded-xl shadow-xl p-0 border-0 max-h-[90vh] overflow-y-auto backdrop:bg-black/50 m-auto`}
    >
      {children}
    </dialog>
  );
};
