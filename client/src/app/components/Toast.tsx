import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { TOPBAR_H } from '../utils/layout';

// App-wide action feedback (Sprint 23k / audit X2). One ToastProvider at the
// app root; screens call useToast().success/error/info after mutations so
// every save/archive/create confirms the same way. NOT for field-level
// validation (bare red text) or section banners (Notice.tsx) — this is for
// "the action you just took landed / failed".
type Variant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: Variant;
  message: string;
  /** exit animation in progress (Sprint 23w) — removed ~160ms after set */
  leaving?: boolean;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};

// Success is a FILLED banner; error and info stay as cards.
//
// Asked for after a classmate reported not noticing that a save had happened
// (2026-09-02). Saves were already announced — backlog 0f audited all 34
// mutation sites — but a small tinted icon on a white card in the bottom-right
// corner is easy to miss when you are looking at the form you just submitted.
//
// ⚠ The reference screenshot used white text on a LIGHT green (~1.9:1), which
// fails WCAG AA badly. `--success` is green-700 #15803D and its own token
// comment says "legible on white"; white text ON it measures ~5.0:1, which
// passes AA for normal text. Keep the fill on that token — a lighter, friendlier
// green would quietly break contrast.
const STYLES: Record<Variant, { Icon: typeof CheckCircle2; icon: string; box: string; close: string }> = {
  success: {
    Icon: CheckCircle2,
    icon: 'text-white',
    box: 'bg-success text-white border-transparent',
    close: 'text-white/80 hover:text-white',
  },
  error: {
    Icon: AlertCircle,
    icon: 'text-destructive',
    box: 'bg-card text-foreground border-border',
    close: 'text-muted-foreground hover:text-foreground',
  },
  info: {
    Icon: Info,
    icon: 'text-primary',
    box: 'bg-card text-foreground border-border',
    close: 'text-muted-foreground hover:text-foreground',
  },
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  // two-step removal so the exit can animate: mark leaving (CSS .toast-leave
  // plays, 150ms), then actually remove. Under prefers-reduced-motion the
  // animation is a no-op and the toast just disappears 160ms later.
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 160);
  }, []);

  const push = useCallback(
    (variant: Variant, message: string) => {
      const id = nextId.current++;
      // cap at 3 visible so a burst of saves can't wallpaper the screen
      setToasts((prev) => [...prev.slice(-2), { id, variant, message }]);
      // errors linger longer; both well past WCAG minimums for short text
      // Success now dwells longer too: the point of the change is that a save
      // gets NOTICED, and 4s was short enough to miss while looking elsewhere.
      window.setTimeout(() => dismiss(id), variant === 'error' ? 6000 : 5500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        // TOP-CENTRE, not the bottom-right corner. Confirmation belongs where
        // the eye already is after pressing Save, and the old corner position
        // is the main reason a save could go unnoticed. Leaves the bottom-right
        // corner to UpdateToast, which no longer has to share.
        <div
          // Below the fixed status strip and above it in stacking order:
          // at `top-4 z-50` a toast rendered underneath the strip, which is
          // 48px tall. Transient feedback has to beat all page chrome.
          style={{ top: TOPBAR_H + 8 }}
          className="fixed inset-x-0 z-[80] flex flex-col gap-2 items-center px-4 pointer-events-none"
        >
          {toasts.map((t) => {
            const { Icon, icon, box, close } = STYLES[t.variant];
            return (
              <div
                key={t.id}
                role={t.variant === 'error' ? 'alert' : 'status'}
                className={`${t.leaving ? 'toast-leave' : 'toast-drop'} pointer-events-auto ${box} rounded-xl border shadow-lg px-5 py-3.5 flex items-center gap-3 max-w-md w-full sm:w-auto`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${icon}`} />
                <span className="text-sm font-medium min-w-0">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className={`${close} shrink-0 ml-1`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
};
