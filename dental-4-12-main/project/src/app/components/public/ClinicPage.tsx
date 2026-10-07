import { useState } from 'react';
import { CLINIC_SERVICES, FAQ, SCHOOLS } from './publicContent';
import { GlassCard, Section, SectionHead, Tag } from './PublicLayout';

// Photos live in public/landing/clinic/. Replace a file to change a picture.
const Faq = () => {
  const [open, setOpen] = useState(0);
  return (
    <div className="grid max-w-3xl gap-2.5">
      {FAQ.map(([q, a], n) => (
        <div key={q} className="overflow-hidden rounded-[18px] border border-white/15 bg-white/[0.07]">
          <button type="button" aria-expanded={open === n} onClick={() => setOpen(open === n ? -1 : n)} className="flex w-full items-center justify-between gap-3.5 px-[18px] py-4 text-left font-bold">
            {q}<span aria-hidden="true" className="text-xl leading-none text-sky-300">{open === n ? '–' : '+'}</span>
          </button>
          {open === n && <p className="px-[18px] pb-4 text-[14.5px] text-blue-100/80">{a}</p>}
        </div>
      ))}
    </div>
  );
};

export const ClinicPage = () => (
  <>
    <section className="relative flex min-h-[520px] items-center pt-12">
      <div className="absolute inset-0">
        <img src="/landing/clinic/team.jpg" alt="The school dental clinic team" className="h-full w-full object-cover [object-position:50%_35%]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,52,140,0.82)_0%,rgba(37,84,200,0.55)_45%,rgba(56,130,230,0.12)_100%),linear-gradient(0deg,rgba(18,38,107,0.9)_0%,transparent_28%)]" />
      </div>
      <div className="relative mx-auto w-full max-w-6xl px-5 py-16 text-left">
        <Tag>The School Dental Clinics</Tag>
        <h1 className="mt-4 max-w-[15ch] text-balance text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl">Care that starts at the school</h1>
        <p className="mt-3 max-w-[52ch] text-lg text-blue-100/90">The Barangay Tanyag school dental clinics bring screening, fluoride varnish and preventive care to students at their own schools. Floral keeps the record behind every visit.</p>
      </div>
    </section>

    <section className="bg-[#F8FAFD] py-16 text-[#0F1B3D] sm:py-[72px]">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em] text-blue-600">The program</div>
          <h2 className="mt-3.5 text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-blue-950 sm:text-5xl">
            Preventive care<span className="block text-blue-600">for every child.</span>
          </h2>
          <p className="mt-5 max-w-[56ch] text-lg leading-8 text-slate-600">
            Every child receives preventive care at their own school. Each service below is recorded on the child’s chart, so the next visit starts from what was already done.
          </p>
          <ol className="mt-7 grid gap-3.5">
            {CLINIC_SERVICES.map(([title, text], i) => (
              <li key={title} className="flex gap-4 rounded-[20px] border border-blue-100 bg-white px-5 py-[18px] shadow-[0_10px_26px_rgba(30,64,175,0.06)]">
                <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[13px] bg-blue-50 font-extrabold text-blue-600">{i + 1}</span>
                <div><h3 className="font-bold text-blue-950">{title}</h3><p className="mt-0.5 text-sm leading-relaxed text-slate-500">{text}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <div className="relative min-w-0">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-60 w-60 rounded-full bg-blue-300/60 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 -left-8 h-60 w-60 rounded-full bg-sky-300/50 blur-3xl" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[32px] border border-white bg-white p-2.5 shadow-[0_30px_70px_rgba(23,37,84,0.14)]">
            <img src="/landing/clinic/chairside.jpg" alt="A dentist screening a child at a school dental clinic" loading="lazy" className="h-full w-full rounded-3xl object-cover [object-position:50%_40%]" />
          </div>
        </div>
      </div>
    </section>

    <Section>
      <SectionHead tag="Schools" title="Three schools at Barangay Tanyag, Taguig City" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SCHOOLS.map((s) => (
          <GlassCard key={s.name} className="p-[22px]">
            <h3 className="font-bold" aria-label={s.name}>{s.lines[0]}<br />{s.lines[1]}</h3>
            <span className="mt-3 inline-block rounded-full border border-sky-300/40 bg-sky-400/15 px-3 py-0.5 text-xs font-bold text-sky-200">{s.grades}</span>
            <p className="mt-2 text-sm text-blue-200">{s.text}</p>
          </GlassCard>
        ))}
      </div>
      <div className="mt-8 h-[clamp(240px,34vw,420px)] overflow-hidden rounded-[26px] border border-white/30 shadow-[0_0_40px_rgba(56,189,248,0.22),0_24px_60px_rgba(3,10,40,0.4)]">
        <img src="/landing/clinic/school-group.jpg" alt="Clinic staff and school partners outdoors" loading="lazy" className="h-full w-full object-cover [object-position:50%_55%]" />
      </div>
    </Section>

    <Section>
      <SectionHead tag="FAQs" title="Find out answers to your possible questions!" />
      <Faq />
    </Section>
  </>
);
