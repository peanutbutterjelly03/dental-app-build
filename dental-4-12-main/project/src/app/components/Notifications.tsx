import { Link } from 'react-router';
import { AlertTriangle, Calendar, Brain, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications, NOTIFIED_ROLES } from '../hooks/useNotifications';

// ─── Notifications page ──────────────────────────────────────────────────────
// Was an inline sidebar popover; moved to its own page on request. The data is
// still exactly what /stats/notifications returns (overdueRpc,
// appointmentsToday, awaitingValidation) -- three real aggregate counts, no
// per-item feed. There is no backing endpoint yet for an itemized list (which
// student's RPC visit, which appointment), so this shows the same three real
// categories as full-width cards instead of inventing row-level detail that
// doesn't exist in the data (CLAUDE.md: nothing fabricated).
export const Notifications = () => {
  const { user, selectedSchool } = useAuth();
  const enabled = NOTIFIED_ROLES.includes(user?.role ?? '');
  const { counts, total, loading, error } = useNotifications(enabled, selectedSchool);
  const canValidateRisk = user?.role === 'dentist';

  if (!enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-1">Notifications aren't shown for this role — School Administrator and Barangay Health Office staff view reports, not clinical records.</p>
      </div>
    );
  }

  const cards = [
    {
      key: 'rpc',
      show: counts.overdueRpc > 0,
      icon: Calendar,
      tone: 'text-destructive',
      chip: 'bg-danger-surface text-destructive',
      count: counts.overdueRpc,
      label: `overdue RPC visit${counts.overdueRpc === 1 ? '' : 's'}`,
      detail: 'Visit 1 recorded, Visit 2 still due and past the interval.',
      linkTo: '/rpc',
      linkLabel: 'Go to RPC Tracking',
    },
    {
      key: 'appointments',
      show: counts.appointmentsToday > 0,
      icon: Calendar,
      tone: 'text-primary',
      chip: 'bg-primary-surface text-primary',
      count: counts.appointmentsToday,
      label: `appointment${counts.appointmentsToday === 1 ? '' : 's'} today`,
      detail: 'Scheduled for today, across the school in view.',
      linkTo: '/appointments',
      linkLabel: 'Go to Appointments',
    },
    ...(canValidateRisk ? [{
      key: 'risk',
      show: counts.awaitingValidation > 0,
      icon: Brain,
      tone: 'text-warning',
      chip: 'bg-warning-surface text-warning',
      count: counts.awaitingValidation,
      label: `risk assessment${counts.awaitingValidation === 1 ? '' : 's'} awaiting validation`,
      detail: 'Predicted, not yet reviewed by the dentist.',
      linkTo: '/ai-analytics',
      linkLabel: 'Go to Risk Classification',
    }] : []),
  ];

  const visibleCards = cards.filter((c) => c.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <p className="text-muted-foreground mt-1">
          {loading ? 'Loading…' : `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention`}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-danger-surface text-destructive text-sm rounded-xl border border-destructive/20 p-4">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Counts unavailable right now.
        </div>
      )}

      {!loading && !error && visibleCards.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 bg-card rounded-xl border border-border p-12 text-center">
          <Bell className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {visibleCards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.key}
              to={c.linkTo}
              className="group flex items-center gap-4 bg-card rounded-xl border border-border p-5 hover:border-primary/30 transition-colors"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${c.chip}`}>
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground">
                  <span className={`font-bold ${c.tone}`}>{c.count}</span> {c.label}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">{c.detail}</p>
              </div>
              <span className="text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {c.linkLabel} →
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
