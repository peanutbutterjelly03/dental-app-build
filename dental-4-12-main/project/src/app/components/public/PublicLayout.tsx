import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';

// Night Clinic ground, shared with the sign-in page so the public site and the
// login read as one thing.
// The brand's tooth, drawn as a large faint watermark behind every public page.
const TOOTH_PATH =
  'M 120.00,34.00 C 125.79,34.50 145.39,30.00 154.72,37.00 C 164.05,44.00 174.12,60.83 176.00,76.00 C 177.88,91.17 167.92,115.35 166.00,128.00 C 164.08,140.65 167.37,134.73 166.00,142.00 C 164.63,149.27 159.52,165.05 157.35,173.90 C 155.18,182.75 156.06,191.57 153.00,195.10 C 149.94,198.63 142.03,197.88 139.00,195.10 C 135.97,192.32 135.80,185.58 134.80,178.40 C 133.80,171.22 135.22,158.06 133.00,152.00 C 130.78,145.94 123.90,138.00 120.00,138.00 C 116.10,138.00 109.22,145.94 107.00,152.00 C 104.78,158.06 106.20,171.22 105.20,178.40 C 104.20,185.58 104.03,192.32 101.00,195.10 C 97.97,197.88 90.06,198.63 87.00,195.10 C 83.94,191.57 84.82,182.75 82.65,173.90 C 80.48,165.05 75.37,149.27 74.00,142.00 C 72.63,134.73 75.92,140.65 74.00,128.00 C 72.08,115.35 62.12,91.17 64.00,76.00 C 65.88,60.83 75.95,44.00 85.28,37.00 C 94.61,30.00 114.21,34.50 120.00,34.00 C 125.79,33.50 114.21,33.50 120.00,34.00 Z';

export const PUBLIC_GROUND = 'linear-gradient(160deg, #0A1330 0%, #12266B 55%, #1B3FA8 100%)';

const LINKS = [
  { to: '/home', label: 'Home' },
  { to: '/about', label: 'About Floral' },
  { to: '/clinic', label: 'Clinic' },
] as const;

export const Tag = ({ children }: { children: ReactNode }) => (
  <span className="inline-block rounded-full border border-sky-300/40 bg-sky-400/10 px-3.5 py-1 text-xs font-semibold text-sky-300">
    {children}
  </span>
);

export const SectionHead = ({ tag, title, lead }: { tag?: string; title: string; lead?: string }) => (
  <div className="mb-8 flex flex-col gap-3">
    {tag && <div><Tag>{tag}</Tag></div>}
    <h2 className="text-balance text-2xl font-extrabold tracking-tight text-white sm:text-4xl">{title}</h2>
    {lead && <p className="max-w-[60ch] text-base text-blue-100/80">{lead}</p>}
  </div>
);

export const Section = ({ children, alt = false }: { children: ReactNode; alt?: boolean }) => (
  <section className={alt ? 'bg-[#060e28]/45 py-14 sm:py-16' : 'py-14 sm:py-16'}>
    <div className="mx-auto max-w-6xl px-5">{children}</div>
  </section>
);

export const GlassCard = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur-sm ${className}`}>{children}</div>
);

export const PrimaryLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="inline-block rounded-xl bg-sky-400 px-5 py-3 text-sm font-bold text-[#06204A] transition hover:-translate-y-px hover:brightness-110">{children}</Link>
);

export const SecondaryLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="inline-block rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-px hover:bg-white/20">{children}</Link>
);

export const PublicLayout = () => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3.5 py-2 text-sm font-medium transition ${isActive ? 'bg-white/15 text-white font-semibold' : 'text-white/85 hover:bg-white/10'}`;

  return (
    <div className="relative min-h-screen overflow-x-hidden text-white" style={{ background: PUBLIC_GROUND }}>
      <svg aria-hidden="true" viewBox="30 20 150 190" className="pointer-events-none absolute -right-28 top-20 hidden w-[560px] fill-white opacity-[0.07] md:block">
        <path d={TOOTH_PATH} />
      </svg>

      <header className="relative z-20 mx-auto max-w-6xl px-3 pt-3.5">
        <div className="relative flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-2.5 backdrop-blur-md">
          <Link to="/home" className="flex items-center gap-2.5" aria-label="Floral home">
            <img src="/logo.svg" alt="" aria-hidden="true" className="h-9 w-9 object-contain" />
            <span className="leading-tight">
              <span className="block text-lg font-extrabold tracking-tight">Floral</span>
              <span className="block text-[11px] text-white/65">School dental health records</span>
            </span>
          </Link>

          <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-white/20 p-2 md:hidden" aria-expanded={open} aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <nav aria-label="Main" className={`${open ? 'flex' : 'hidden'} absolute left-0 right-0 top-full z-30 mt-2 flex-col gap-1 rounded-2xl border border-white/15 bg-[#0E1B45] p-2 md:static md:mt-0 md:flex md:flex-row md:items-center md:border-0 md:bg-transparent md:p-0`}>
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} className={linkClass}>{l.label}</NavLink>)}
            <Link to="/login" className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-bold text-[#06204A] transition hover:brightness-110 md:ml-1.5">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10"><Outlet /></main>

    </div>
  );
};
