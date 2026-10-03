import { CloudDownload, CheckCircle2, PauseCircle } from 'lucide-react';
import { useOfflineData } from '../hooks/useOfflineData';

// One honest line about offline readiness: is every student's chart on this device
// yet? It only says what the background sync (offline/bulkSync.ts) actually did,
// so "ready" means every student in the person's schools can be opened offline.
// Renders nothing for someone whose role does not download (it stays "idle").
const count = (n: number) => n.toLocaleString();

export const OfflineDataStatus = () => {
  const { state, done, total, completedAt } = useOfflineData();
  if (state === 'idle') return null;

  const of = total !== null ? ` of ${count(total)}` : '';
  const updated = completedAt ? new Date(completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  const Icon = state === 'ready' ? CheckCircle2 : state === 'paused' ? PauseCircle : CloudDownload;
  const tone = state === 'ready' ? 'text-emerald-700' : state === 'paused' ? 'text-amber-700' : 'text-muted-foreground';

  return (
    <p className={`mt-1 inline-flex items-center gap-1.5 text-xs ${tone}`} role="status">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      {state === 'ready' && `Offline data ready: ${count(total ?? done)} students${updated ? `. Updated ${updated}` : ''}.`}
      {state === 'syncing' && `Preparing offline data: ${count(done)}${of} students.`}
      {state === 'paused' && `Offline data paused at ${count(done)}${of} students. It continues when you are back online.`}
    </p>
  );
};
