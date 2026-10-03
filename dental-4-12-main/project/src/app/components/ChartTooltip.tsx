// Shared recharts tooltip so every chart's hover box matches the app's design
// language (rounded-lg / border-gray-200 / shadow / text-xs) instead of the
// bare recharts default. Per dataviz rules: text wears ink tokens (never the
// series color) and a small color swatch carries identity.

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  // recharts stashes the row + its fill here; used as a swatch fallback (pie).
  payload?: { fill?: string; color?: string };
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== '' && (
        <div className="mb-1 font-medium text-foreground">{label}</div>
      )}
      <div className="space-y-0.5">
        {payload.map((entry, i) => {
          const swatch = entry.color ?? entry.payload?.fill ?? entry.payload?.color;
          return (
            <div key={i} className="flex items-center gap-2">
              {swatch && (
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                  style={{ backgroundColor: swatch }}
                />
              )}
              {entry.name !== undefined && <span className="text-muted-foreground">{entry.name}</span>}
              <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
                {entry.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
