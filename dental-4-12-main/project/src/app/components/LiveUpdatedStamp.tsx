/**
 * "Updated 10:42" for a report whose numbers refresh themselves (Sprint 110).
 *
 * ⚠ THE TIME SHOWN IS A REAL FETCH TIME, not a ticking clock. It only moves
 * when `/stats/last-change` reported that something actually changed and the
 * report re-read the database. A stamp that advanced on a timer would be a
 * fake live indicator — exactly the placeholder CLAUDE.md forbids, and worse
 * than showing nothing because it looks authoritative.
 *
 * Renders NOTHING until the first real refresh. Before that there is nothing
 * true to say: "Updated <page load time>" would imply a freshness check that
 * has not happened yet.
 */
export const LiveUpdatedStamp = ({ at }: { at: Date | null }) => {
  if (!at) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      // Says the quiet part: this is near-live, not live-to-the-second.
      title="These figures refresh on their own, usually within a few seconds of a change being saved by anyone."
    >
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
      Updated {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
};
