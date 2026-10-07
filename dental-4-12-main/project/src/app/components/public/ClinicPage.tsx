import { useState } from 'react';
import { FAQ, ROLES, RPC_STEPS, SCHOOLS } from './publicContent';
import { GlassCard, Section, SectionHead } from './PublicLayout';

const Accordion = ({ items }: { items: ReadonlyArray<readonly [string, string]> }) => {
  const [open, setOpen] = useState(0);
  return (
    <div className="grid gap-2">
      {items.map(([q, a], n) => (
        <div key={q} className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07]">
          <button type="button" aria-expanded={open === n} onClick={() => setOpen(open === n ? -1 : n)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left font-bold">
            {q}<span aria-hidden="true" className="text-lg leading-none text-sky-300">{open === n ? '–' : '+'}</span>
          </button>
          {open === n && <p className="px-4 pb-3.5 text-sm text-blue-100/80">{a}</p>}
        </div>
      ))}
    </div>
  );
};

export const ClinicPage = () => {
  const [school, setSchool] = useState(0);
  return (
    <>
      <Section>
        <SectionHead tag="The clinic" title="Barangay Tanyag school dental program" lead="One dentist, one dental aide and three clinic staff serve the students of three public schools." />
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2.5 font-bold">Schools</h3>
            <div className="grid gap-2.5">
              {SCHOOLS.map((s, n) => (
                <button key={s.name} type="button" aria-pressed={n === school} onClick={() => setSchool(n)}
                  className={`flex justify-between gap-3 rounded-2xl border bg-white/[0.07] px-4 py-3.5 text-left font-semibold ${n === school ? 'border-sky-400 ring-2 ring-sky-400/60' : 'border-white/15'}`}>
                  {s.name}<span className="whitespace-nowrap font-medium text-blue-100/70">{s.grades}</span>
                </button>
              ))}
            </div>
            <GlassCard className="mt-3">
              <h4 className="font-bold">{SCHOOLS[school].name}</h4>
              <p className="mt-1.5 text-sm text-blue-100/75">{SCHOOLS[school].text} Student counts appear after sign-in, from the database.</p>
            </GlassCard>
          </div>
          <div>
            <h3 className="mb-2.5 font-bold">Who uses Floral</h3>
            <Accordion items={ROLES} />
          </div>
        </div>
      </Section>

      <Section alt>
        <SectionHead tag="The program" title="Two visits per child" lead="Each visit follows the same checklist, so progress is easy to compare." />
        <div className="grid gap-3.5 sm:grid-cols-2">
          {[1, 2].map((v) => (
            <GlassCard key={v}>
              <h3 className="mb-2 font-bold">Visit {v}</h3>
              <ul className="grid gap-2">{RPC_STEPS.map((s) => <li key={s} className="flex gap-2.5 text-sm text-blue-100/80"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />{s}</li>)}</ul>
            </GlassCard>
          ))}
        </div>
      </Section>

      <Section>
        <div className="max-w-3xl">
          <SectionHead title="Common questions" />
          <Accordion items={FAQ} />
        </div>
      </Section>
    </>
  );
};
