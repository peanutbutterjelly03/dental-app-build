import { Link } from 'react-router';
import { Bell, Calendar, Brain, Shield, StickyNote } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications, NOTIFIED_ROLES } from '../hooks/useNotifications';

// ⚠ THREE REAL AGGREGATE COUNTS, SAME AS THE SIDEBAR BELL — NOT A PER-ITEM
// FEED. There is no NOTIFICATION model and no read/unread state (see
// useNotifications.ts); this page shares that hook rather than inventing a
// list CLAUDE.md's "nothing cosmetic" rule would call fabricated.
export const Notifications = () => {
  const { user, selectedSchool } = useAuth();
  const enabled = NOTIFIED_ROLES.includes(user?.role ?? '');
  const { counts, total, loading, error } = useNotifications(enabled, selectedSchool);
  const canValidateRisk = user?.role === 'dentist';

  if (!enabled) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-muted-foreground">Notifications aren't used by your role.</p>
        </div>
      </div>
    );
  }

  const items = [
    counts.overdueRpc > 0 && {
      key: 'rpc',
      to: '/rpc',
      icon: Shield,
      color: 'text-destructive',
      badge: 'bg-danger-surface text-destructive',
      count: counts.overdueRpc,
      label: `overdue RPC visit${counts.overdueRpc === 1 ? '' : 's'}`,
    },
    counts.appointmentsToday > 0 && {
      key: 'appointments',
      to: '/appointments',
      icon: Calendar,
      color: 'text-primary',
      badge: 'bg-primary-surface text-primary',
      count: counts.appointmentsToday,
      label: `appointment${counts.appointmentsToday === 1 ? '' : 's'} today`,
    },
    counts.awaitingValidation > 0 && canValidateRisk && {
      key: 'risk',
      to: '/ai-analytics',
      icon: Brain,
      color: 'text-warning',
      badge: 'bg-warning-surface text-warning',
      count: counts.awaitingValidation,
      label: `risk assessment${counts.awaitingValidation === 1 ? '' : 's'} awaiting validation`,
    },
    counts.remindersToday > 0 && {
      key: 'reminders',
      to: '/appointments',
      icon: StickyNote,
      color: 'text-warning',
      badge: 'bg-warning-surface text-warning',
      count: counts.remindersToday,
      label: `calendar reminder${counts.remindersToday === 1 ? '' : 's'} for today`,
    },
  ].filter(Boolean) as Array<{
    key: string; to: string; icon: typeof Shield; color: string; badge: string; count: number; label: string;
  }>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {loading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'} need attention`}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-destructive text-sm">Counts unavailable right now.</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Bell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Nothing needs attention.</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map(({ key, to, icon: Icon, color, badge, count, label }) => (
          <Link
            key={key}
            to={to}
            className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:border-primary/40 hover:bg-primary-surface/30 transition-colors"
          >
            <span className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${badge}`}>
              <Icon className="w-5 h-5" />
            </span>
            <span className="text-sm text-foreground">
              <span className={`font-semibold ${color}`}>{count}</span> {label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
};
