// Skeleton loading states. Same card shells as the real content
// (bg-card, rounded-xl, border-border tokens) so the layout doesn't jump
// when data arrives; pulsing muted blocks stand in for text.

const block = 'animate-pulse bg-muted rounded';

export const SkeletonBlock = ({ className = '' }: { className?: string }) => (
  <div className={`${block} ${className}`} aria-hidden="true" />
);

/** Page heading placeholder (title + subtitle). */
export const SkeletonPageHeader = () => (
  <div className="space-y-2">
    <SkeletonBlock className="h-7 w-48" />
    <SkeletonBlock className="h-4 w-64" />
  </div>
);

/** Grid of stat/KPI cards, like the dashboard and RPC tiles. */
export const SkeletonStatGrid = ({ count = 4 }: { count?: number }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-card rounded-xl border border-border p-4 space-y-3">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-7 w-14" />
      </div>
    ))}
  </div>
);

/** Table-style card: header row + N data rows. */
export const SkeletonTable = ({ rows = 6 }: { rows?: number }) => (
  <div className="bg-card rounded-xl border border-border p-4 space-y-4">
    <div className="flex gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-4 w-24" />
      ))}
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-6">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-4 w-16" />
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
    ))}
  </div>
);

/** Two large chart/content card placeholders side by side. */
export const SkeletonChartCards = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {[0, 1].map((i) => (
      <div key={i} className="bg-card rounded-xl border border-border p-4 space-y-4">
        <SkeletonBlock className="h-5 w-40" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    ))}
  </div>
);
