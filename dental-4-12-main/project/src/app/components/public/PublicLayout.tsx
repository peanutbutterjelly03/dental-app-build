import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';

// Night Clinic ground, shared with the sign-in page so the public site and the
// login read as one thing.
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

      <footer className="relative z-10 border-t border-white/15 py-6 text-sm text-white/65">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5">
          <span>Floral · Barangay Tanyag, Taguig City</span>
          <span>Internal use only</span>
        </div>
      </footer>
    </div>
  );
};
