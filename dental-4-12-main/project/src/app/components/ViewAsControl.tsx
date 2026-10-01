import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Eye, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../hooks/useUsers';
import { VIEW_AS_AVAILABLE } from '../utils/viewAs';
import type { ApiRole } from '../api/types';

// The "View as" control (2026-10-01; see utils/viewAs.ts for the rules).
// Rendered by RootLayout beside the app, like SessionLock, so it needs no edit
// to any screen. Shown only to a REAL System Admin, and only off the live site.

// In TESTING MODE (OPEN_ACCESS_TESTING on the server) it is shown to every
// signed-in user, on the live site too, and the preview can save.
const PREVIEW_ROLES: ApiRole[] = ['dentist', 'dental_aide', 'school_admin', 'bho_staff', 'system_admin'];

export function ViewAsControl() {
  const { realRole, viewAs, setViewAs, testingMode } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const available = testingMode ? !!realRole : VIEW_AS_AVAILABLE && realRole === 'system_admin';
  if (!available) return null;
  const roles = PREVIEW_ROLES.filter((r) => r !== realRole);

  // Back to the Dashboard on every switch: the page you were on may not exist
  // for the role you switched to, and routes carry no role guard (SEC-34).
  const choose = (role: ApiRole | null) => {
    setViewAs(role);
    setOpen(false);
    navigate('/');
  };

  if (viewAs) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[250] flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg"
        role="status">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Viewing as <strong>{ROLE_LABELS[viewAs]}</strong>.{' '}
          {testingMode ? 'Testing mode: saving works and is recorded under your account.' : 'Read-only preview: saving is turned off.'}
        </span>
        <button type="button" onClick={() => choose(null)}
          className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Exit
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[250]">
      {open && (
        <div className="mb-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-xl" role="menu">
          <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {testingMode
              ? 'Switch role for testing. Saving works; saves are recorded under your account.'
              : 'Preview the app as another role. Read-only; the server still treats you as System Admin.'}
          </div>
          {roles.map((role) => (
            <button key={role} type="button" role="menuitem" onClick={() => choose(role)}
              className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted">
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="ml-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg hover:bg-muted">
        <Eye className="h-4 w-4" aria-hidden="true" /> View as
      </button>
    </div>
  );
}
