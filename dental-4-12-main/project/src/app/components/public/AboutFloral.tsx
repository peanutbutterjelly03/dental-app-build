import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { FEATURES, MODULES, ROLE_CARDS } from './publicContent';
import { Section, SectionHead, Tag } from './PublicLayout';

const PRIVACY = [
  ['Encrypted at rest', 'Names, contacts, diagnoses and medical details are encrypted before they reach the database.'],
  ['Nothing is deleted', 'Records are archived. Only the System Admin can restore them.'],
  ['Every action is logged', 'Additions, edits and archives are written to an audit trail.'],
  ['Internal use only', 'A standalone clinic system with no link to national databases.'],
] as const;

// Pictures live in public/landing/about/. Replace a file to change a picture; the name
// and the 4:3 or 16:10 shape are what the layout expects.
const Picture = ({ name, className }: { name: string; className: string }) => (
  <div className={`relative overflow-hidden bg-[#12266B] ${className}`}>
    <img src={`/landing/about/${name}.jpg`} alt="" aria-hidden="true" loading="lazy" className="block h-full w-full object-cover" />
  </div>
);

const lightTag = 'inline-block rounded-full border border-[#1E40AF]/40 bg-[#E6EEFF] px-3.5 py-1 text-xs font-semibold text-[#1E40AF]';

const Light = ({ children }: { children: ReactNode }) => (
  <section className="bg-[#F3F6FD] py-14 text-[#0F1B3D] sm:py-16"><div className="mx-auto max-w-6xl px-5">{children}</div></section>
);

const WorkRail = () => {
  const rail = useRef<HTMLDivElement>(null);
  const move = (dir: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.current?.scrollBy({ left: dir * 360, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <>
      <div className="mb-3.5 flex gap-2">
        <button type="button" onClick={() => move(-1)} aria-label="Previous" className="grid h-10 w-10 place-items-center rounded-full border border-[#C9D8F5] bg-white text-[#1E40AF] transition hover:bg-[#E6EEFF]"><ArrowLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => move(1)} aria-label="Next" className="grid h-10 w-10 place-items-center rounded-full border border-[#C9D8F5] bg-white text-[#1E40AF] transition hover:bg-[#E6EEFF]"><ArrowRight className="h-4 w-4" /></button>
      </div>
      <div ref={rail} role="region" aria-label="Floral at work" tabIndex={0} className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FEATURES.map((f, i) => (
          <article key={f.tag} className="flex w-[min(340px,82%)] shrink-0 snap-start flex-col overflow-hidden rounded-[28px] border border-[#D6DFF2] bg-white shadow-[0_16px_44px_rgba(30,64,175,0.12)]">
            <Picture name={f.image} className="aspect-[4/3]" />
            <div className="flex-1 px-[22px] pb-6 pt-5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1E40AF]">0{i + 1} · {f.tag}</span>
              <h3 className="mt-1.5 text-balance text-xl font-bold">{f.title}</h3>
              <p className="mt-2 text-sm text-[#4B5878]">{f.text}</p>
              <ul className="mt-3 grid gap-2">
                {f.bullets.map((b) => <li key={b} className="flex gap-2.5 text-[13.5px] text-[#4B5878]"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1E40AF]" />{b}</li>)}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </>
  );
};

export const AboutFloral = () => (
  <>
    <div className="mx-auto grid max-w-6xl items-center gap-9 px-5 pb-14 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div>
        <Tag>About Floral</Tag>
        <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Dental records for the clinic, in one place</h1>
        <p className="mt-3 max-w-[60ch] text-lg text-blue-100/85">
          Floral is a dental health record management system for school dental clinics in Barangay Tanyag, Taguig City. It aims to keep student dental and treatment records in one place across schools, make appointments and follow-ups easier to manage, and help dentists plan preventive care through dashboards, reports and risk classification. It runs in the browser on a phone, tablet or laptop, and it keeps working when the connection drops.
        </p>
      </div>
      <Picture name="hero" className="aspect-[1408/768] rounded-[22px] border border-white/30 shadow-[0_0_40px_rgba(56,189,248,0.25),0_24px_60px_rgba(3,10,40,0.4)]" />
    </div>

    <Light>
      <div className="mb-8 flex flex-col items-start gap-3">
        <span className={lightTag}>See Floral at work</span>
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Built around the clinic's daily work</h2>
      </div>
      <WorkRail />
    </Light>

    <Section>
      <SectionHead tag="Modules" title="Everything in one login" lead="Eight modules that work from the same record." />
      <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map(([name, text, image]) => (
          <div key={name} className="flex flex-col overflow-hidden rounded-3xl border border-white/20 bg-white/[0.07] shadow-[0_0_30px_rgba(56,189,248,0.12)] backdrop-blur-sm">
            <Picture name={image} className="aspect-[16/10]" />
            <div className="px-[22px] pb-6 pt-5"><h3 className="font-bold">{name}</h3><p className="mt-1.5 text-sm text-blue-200">{text}</p></div>
          </div>
        ))}
      </div>
    </Section>

    <Light>
      <div className="mb-8 flex flex-col items-start gap-3">
        <span className={lightTag}>Roles</span>
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Everyone sees only what their job needs</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {ROLE_CARDS.map((r) => (
          <div key={r.name} className="overflow-hidden rounded-[22px] border border-[#D6DFF2] bg-white shadow-[0_10px_30px_rgba(30,64,175,0.08)]">
            <Picture name={r.image} className="aspect-[4/3]" />
            <div className="px-[18px] pb-5 pt-4"><h3 className="font-bold">{r.name}</h3><p className="mt-1.5 text-[13px] text-[#4B5878]">{r.text}</p></div>
          </div>
        ))}
      </div>
    </Light>

    <Section>
      <SectionHead tag="Privacy and safety" title="Student data is handled like clinic data" />
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {PRIVACY.map(([t, d], n) => (
          <div key={t} className="rounded-2xl border border-white/15 bg-white/[0.07] p-[18px] backdrop-blur-sm">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-sky-400/15 font-extrabold text-sky-300">{n + 1}</span>
            <h3 className="mb-1 mt-2.5 font-bold">{t}</h3><p className="text-[13.5px] text-blue-200">{d}</p>
          </div>
        ))}
      </div>
    </Section>

    <div className="mx-auto max-w-6xl px-5 py-16 text-center">
      <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Ready to open the clinic's records?</h2>
      <p className="mx-auto mt-3 max-w-[48ch] text-blue-100/80">Sign in with the account the System Admin created for you.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link to="/login" className="inline-block rounded-xl bg-sky-400 px-5 py-3 text-sm font-bold text-[#06204A] transition hover:-translate-y-px hover:brightness-110">Sign in</Link>
        <Link to="/clinic" className="inline-block rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-px hover:bg-white/20">Meet the clinic</Link>
      </div>
    </div>
  </>
);
