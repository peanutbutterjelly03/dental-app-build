import { AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

// Shared inline banner for section/page-level status messages (form submit
// errors, save confirmations, etc.) so they read the same everywhere instead of
// each screen hand-rolling its own bg-*-50/border/padding. NOT for field-level
// validation lines under a single input — those stay as bare red text.
type Variant = 'error' | 'success' | 'warning';

const STYLES: Record<Variant, { box: string; Icon: typeof AlertCircle }> = {
  error: { box: 'bg-red-50 border-red-200 text-red-700', Icon: AlertCircle },
  success: { box: 'bg-green-50 border-green-200 text-green-800', Icon: CheckCircle2 },
  warning: { box: 'bg-amber-50 border-amber-200 text-amber-800', Icon: AlertTriangle },
};

interface Props {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}

export function Notice({ variant = 'error', children, className = '' }: Props) {
  const { box, Icon } = STYLES[variant];
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${box} ${className}`}
    >
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
