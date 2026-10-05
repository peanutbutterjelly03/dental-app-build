import type { LucideIcon } from 'lucide-react';

// Shared top-of-page identity block: icon, category eyebrow, title,
// one-line description. Same shape as the house style the user asked to
// standardize on across every module (icon square, eyebrow, bold title,
// description underneath) rather than a bare <h1> + <p>.
interface PageHeaderProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  /** Extra content to the right of the title block, e.g. an action button. */
  action?: React.ReactNode;
  /** Unread/attention count shown as a small circle overlapping the icon's
   *  corner (Notifications page). Omit or 0 to render no badge at all --
   *  a page with nothing to count should not sprout an empty circle. */
  badge?: number;
}

export const PageHeader = ({ icon: Icon, eyebrow, title, description, action, badge }: PageHeaderProps) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-3">
      <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-primary-surface">
        <Icon className="h-8 w-8 text-primary" />
        {!!badge && badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-white tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{eyebrow}</div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
    {action}
  </div>
);
