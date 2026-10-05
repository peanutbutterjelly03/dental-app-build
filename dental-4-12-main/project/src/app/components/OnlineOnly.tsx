import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { WifiOff } from 'lucide-react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// Offline works for Student Records, Dental Charts, the Dental Chart and Treatment
// only (offline/ stores their reads and queues their writes). Every other page needs
// the server, so while offline it says so plainly instead of loading forever or
// showing an empty list that looks like missing data.
//
// A page that was ALREADY open when the connection dropped stays mounted (hidden),
// so whatever someone had typed into it is still there when they come back; only
// a page opened while offline is never mounted at all.
export const OnlineOnly = ({ children }: { children: ReactNode }) => {
  const { isOnline } = useOfflineQueue();
  const [mounted, setMounted] = useState(isOnline);
  if (isOnline && !mounted) setMounted(true);

  return (
    <>
      {mounted && <div hidden={!isOnline}>{children}</div>}
      {!isOnline && (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm" role="status">
            <WifiOff className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
            <h1 className="mt-3 text-xl font-semibold text-foreground">This page needs a connection</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              You are offline. Student Records, Dental Charts and Treatment still work, and anything you save there syncs when you are back online.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[
                ['/patients', 'Student Records'],
                ['/dental-charts', 'Dental Charts'],
                ['/treatment-records', 'Treatment'],
              ].map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                >
                  {label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
