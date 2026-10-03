import type { KeyboardEvent } from 'react';

// Makes a non-button element (e.g. a clickable table row) keyboard-operable.
// Spread onto the element in place of its `onClick`: it exposes the element to
// assistive tech as an activatable control and fires the same action on both
// click and Enter/Space — satisfying WCAG 2.1.1 (Keyboard) for rows that
// navigate or toggle on click.
export function activatable(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
