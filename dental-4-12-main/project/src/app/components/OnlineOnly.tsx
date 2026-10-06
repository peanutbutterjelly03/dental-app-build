import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Stethoscope, Users, WifiOff } from 'lucide-react';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// Offline works for Student Records, Dental Charts, the Dental Chart and Treatment
// only (offline/ stores their reads and queues their writes). Every other page needs
// the server, so while offline it says so plainly instead of loading forever or
// showing an empty list that looks like missing data.
//
// A page that was ALREADY open when the connection dropped stays mounted (hidden),
// so whatever someone had typed into it is still there when they come back; only
// a page opened while offline is never mounted at all.
// lucide has no tooth glyph, so this one is drawn here in the same 24px line style.
const ToothIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M7.5 3C5 3 3.5 4.8 3.5 7.3c0 2.2.9 3.7 1.4 6 .4 1.9.5 4.8 1.9 7.1.5.9 1.6.5 1.8-.5.2-1.4.5-2.9 1.4-2.9s1.2 1.5 1.4 2.9c.2 1 1.3 1.4 1.8.5 1.4-2.3 1.5-5.2 1.9-7.1.5-2.3 1.4-3.8 1.4-6C20.5 4.8 19 3 16.5 3c-1.7 0-2.7 1-4.5 1S9.2 3 7.5 3Z" />
  </svg>
);

export const OnlineOnly = ({ children }: { children: ReactNode }) => {
  const { isOnline } = useOfflineQueue();
  const [mounted, setMounted] = useState(isOnline);
  if (isOnline && !mounted) setMounted(true);

  return (
    <>
      {mounted && <div hidden={!isOnline}>{children}</div>}
      {!isOnline && (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          {/* Yellow theme, shortcut rows, navy icons on yellow squares (user pick, 2026-10-06). */}
          <section className="w-full max-w-lg rounded-[1.25rem] border border-[#FDE68A] bg-[#FFFBEB] p-7 text-center shadow-[0_10px_30px_rgba(15,23,42,0.08)]" role="status">
            <div className="mx-auto flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-[1.125rem] bg-[#FFC000] text-primary">
              <WifiOff className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-[1.3rem] font-extrabold text-foreground">This page needs a connection</h1>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
              You are offline. These pages still work, and anything you save there syncs when you are back online.
            </p>
            <div className="mt-5 grid gap-2.5 text-left">
              {([
                ['/patients', 'Student Records', Users],
                ['/dental-charts', 'Dental Charts', ToothIcon],
                ['/treatment-records', 'Treatment', Stethoscope],
              ] as const).map(([to, label, Icon]) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-3 rounded-[0.875rem] border border-[#FCE7A0] bg-white px-3.5 py-2.5 hover:border-[#FFC000] hover:bg-[#FFF8E1]"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[0.6875rem] bg-[#FFC000] text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 text-sm font-bold text-foreground">{label}</span>
                  <ChevronRight className="h-4 w-4 text-[#B45309]" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
};
