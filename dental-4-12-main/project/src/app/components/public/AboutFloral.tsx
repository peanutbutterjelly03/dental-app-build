import { useState } from 'react';
import { Link } from 'react-router';
import { BarChart3, ClipboardList, School, ShieldCheck, Stethoscope } from 'lucide-react';
import { FEATURES, MODULES, ROLE_CARDS, type FeatureKind } from './publicContent';
import { ToothChartDemo } from './Demos';
import { Frame, GlassCard, Section, SectionHead, Tag } from './PublicLayout';

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ['3', 'partner schools'], ['5', 'staff roles'], ['9', 'modules'], ['2', 'RPC visits per child'],
];

const PRIVACY = [
  ['Encrypted at rest', 'Names, contacts, diagnoses and medical details are encrypted before they reach the database.'],
  ['Nothing is deleted', 'Records are archived. Only the System Admin can restore them.'],
  ['Every action is logged', 'Additions, edits and archives are written to an audit trail.'],
  ['Internal use only', 'A standalone clinic system with no link to national databases.'],
] as const;

const ICONS = { admin: ShieldCheck, dentist: Stethoscope, aide: ClipboardList, school: School, bho: BarChart3 } as const;

const IMAGES: Record<Exclude<FeatureKind, 'chart'>, { src: string; alt: string }> = {
  rpc: { src: '/landing/rpc.jpg', alt: 'Floral RPC two-visit funnel: enrolled, visit 1 completed, both visits completed' },
  risk: { src: '/landing/risk.jpg', alt: 'Floral risk distribution: high, medium and low risk' },
  reports: { src: '/landing/reports.jpg', alt: 'Floral DOH consolidated report table' },
};

// Pale bands, as on the approved mock-up: navy and white alternate down the page.
const Light = ({ children }: { children: React.ReactNode }) => (
  <section className="bg-[#F3F6FD] py-14 text-[#0F1B3D] sm:py-16"><div className="mx-auto max-w-6xl px-5">{children}</div></section>
);

const Roles = () => {
  const [i, setI] = useState(1);
  const r = ROLE_CARDS[i];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ROLE_CARDS.map((x, n) => {
          const Icon = ICONS[x.icon];
          return (
            <button key={x.name} type="button" aria-pressed={n === i} onClick={() => setI(n)}
              className={`flex flex-col gap-2 rounded-[18px] border-[1.5px] bg-white p-4 text-left transition hover:-translate-y-0.5 ${n === i ? 'border-[#1E40AF] shadow-[0_14px_34px_rgba(30,64,175,0.18)]' : 'border-[#D6DFF2]'}`}>
              <span className="grid h-[52px] w-[52px] place-items-center rounded-2xl bg-gradient-to-br from-[#1E40AF] to-sky-400"><Icon className="h-6 w-6 text-white" strokeWidth={1.8} /></span>
              <h3 className="font-bold">{x.name}</h3>
              <p className="text-[13px] text-[#4B5878]">{x.text}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border border-[#D6DFF2] bg-white p-4" aria-live="polite">
        <b>{r.name} opens</b>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {r.opens.map((c) => <span key={c} className="rounded-full bg-[#E6EEFF] px-3.5 py-1 text-[13px] font-semibold text-[#1E40AF]">{c}</span>)}
        </div>
      </div>
    </>
  );
};

export const AboutFloral = () => (
  <>
    <div className="mx-auto max-w-6xl px-5 pb-12 pt-6">
      <Tag>About Floral</Tag>
      <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Dental records for the clinic, in one place</h1>
      <p className="mt-3 max-w-[58ch] text-lg text-blue-100/85">Floral replaces the paper IPTR for the Barangay Tanyag school dental program. It runs in the browser on a phone, tablet or laptop, and it keeps working when the connection drops.</p>
    </div>

    <div className="border-y border-white/15 bg-white/[0.05]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 px-5 sm:grid-cols-4">
        {FACTS.map(([n, l]) => (
          <div key={l} className="border-white/15 px-2 py-4 sm:border-r sm:px-5 sm:last:border-r-0">
            <b className="block text-3xl font-extrabold tabular-nums">{n}</b><span className="text-sm text-blue-100/75">{l}</span>
          </div>
        ))}
      </div>
    </div>

    <Light>
      <div className="mb-6 flex flex-col items-start gap-3">
        <span className="inline-block rounded-full border border-[#1E40AF]/40 bg-[#E6EEFF] px-3.5 py-1 text-xs font-semibold text-[#1E40AF]">See Floral at work</span>
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Built around the clinic's daily work</h2>
        <p className="max-w-[56ch] text-base text-[#4B5878]">Four of the nine modules, as staff use them.</p>
      </div>
      {FEATURES.map((f, n) => (
        <div key={f.kind} className="grid items-center gap-8 py-8 lg:grid-cols-2 lg:gap-14">
          <div className={n % 2 ? 'lg:order-2' : ''}>
            <span className="inline-block rounded-full border border-[#1E40AF]/40 bg-[#E6EEFF] px-3.5 py-1 text-xs font-semibold text-[#1E40AF]">{f.tag}</span>
            <h3 className="mt-3 text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">{f.title}</h3>
            <p className="mt-2.5 max-w-[50ch] text-[#4B5878]">{f.text}</p>
            <ul className="mt-4 grid gap-2">
              {f.bullets.map((b) => <li key={b} className="flex gap-2.5 text-[14.5px] text-[#4B5878]"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1E40AF]" />{b}</li>)}
            </ul>
          </div>
          <div className={n % 2 ? 'lg:order-1' : ''}>
            <Frame url={f.url} chip={f.chip} light>
              {f.kind === 'chart'
                ? <div className="bg-[#0E1B45] p-3 text-white"><ToothChartDemo /></div>
                : <img src={IMAGES[f.kind].src} alt={IMAGES[f.kind].alt} className="block h-auto w-full" />}
            </Frame>
          </div>
        </div>
      ))}
    </Light>

    <Section>
      <SectionHead title="Nine modules, one login" />
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map(([name, text], n) => (
          <GlassCard key={name} className="flex flex-col gap-1.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/15 text-sm font-extrabold text-sky-300">{n + 1}</span>
            <h3 className="font-bold">{name}</h3>
            <p className="text-sm text-blue-100/75">{text}</p>
          </GlassCard>
        ))}
      </div>
    </Section>

    <Light>
      <div className="mb-8 flex flex-col items-start gap-3">
        <span className="inline-block rounded-full border border-[#1E40AF]/40 bg-[#E6EEFF] px-3.5 py-1 text-xs font-semibold text-[#1E40AF]">Roles</span>
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Everyone sees only what their job needs</h2>
        <p className="max-w-[56ch] text-base text-[#4B5878]">Select a role to see what it opens.</p>
      </div>
      <Roles />
    </Light>

    <Section>
      <SectionHead tag="Privacy and safety" title="Student data is handled like clinic data" />
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {PRIVACY.map(([t, d], n) => (
          <GlassCard key={t}>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/15 font-extrabold text-sky-300">{n + 1}</span>
            <h3 className="mb-1 mt-2.5 font-bold">{t}</h3><p className="text-sm text-blue-100/75">{d}</p>
          </GlassCard>
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
