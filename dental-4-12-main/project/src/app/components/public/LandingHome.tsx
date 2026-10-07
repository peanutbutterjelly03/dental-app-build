import { useState } from 'react';
import { Link } from 'react-router';
import { ACCESS_COLS, ACCESS_ROWS, FLOW, MODULES, SCHOOLS } from './publicContent';
import { GlassCard, PrimaryLink, Section, SectionHead, SecondaryLink, Tag } from './PublicLayout';

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ['3', 'partner schools'], ['5', 'staff roles'], ['7', 'modules'], ['2', 'RPC visits per child'],
];

const PRIVACY = [
  ['Encrypted at rest', 'Names, addresses, contacts, diagnoses and medical details are encrypted before they reach the database.'],
  ['Nothing is deleted', 'Records are archived. Only the System Admin can view or restore them.'],
  ['Every action is logged', 'Additions, edits and archives are written to an audit trail across all three schools.'],
  ['Internal use only', 'Floral is a standalone clinic system with no link to national databases.'],
] as const;

const FlowSection = () => {
  const [i, setI] = useState(0);
  const f = FLOW[i];
  return (
    <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
      <div role="tablist" className="flex gap-1.5 overflow-x-auto pb-1.5 md:flex-col md:overflow-visible">
        {FLOW.map((s, n) => (
          <button key={s.t} role="tab" aria-selected={n === i} onClick={() => setI(n)}
            className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition md:whitespace-normal ${n === i ? 'border-sky-400 bg-white/10' : 'border-transparent hover:bg-white/5'}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${n === i ? 'border-sky-400 bg-sky-400 text-[#06204A]' : 'border-sky-300/40 text-sky-300'}`}>{n + 1}</span>
            {s.t}
          </button>
        ))}
      </div>
      <GlassCard className="min-h-[250px]">
        <Tag>Step {i + 1} of {FLOW.length}</Tag>
        <h3 className="mt-3 text-xl font-bold">{f.t}</h3>
        <p className="mt-1.5 text-sm text-blue-100/80">{f.p}</p>
        <dl className="mt-3 grid gap-1.5">
          {f.kv.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-t border-white/15 pt-2 text-sm"><dt className="text-blue-100/70">{k}</dt><dd className="text-right font-bold">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4 flex gap-2">
          <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-bold disabled:opacity-40">Back</button>
          <button type="button" disabled={i === FLOW.length - 1} onClick={() => setI(i + 1)} className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-bold text-[#06204A] disabled:opacity-40">Next step</button>
        </div>
      </GlassCard>
    </div>
  );
};

const AccessMatrix = () => {
  const [hl, setHl] = useState(-1);
  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/[0.07]">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-3 text-left text-[11px] font-semibold uppercase tracking-wider text-blue-100/70">Capability</th>
              {ACCESS_COLS.map((c, n) => (
                <th key={c} className={`p-0 text-[11px] font-semibold uppercase tracking-wider ${n === hl ? 'bg-sky-400/15 text-sky-300' : 'text-blue-100/70'}`}>
                  <button type="button" aria-pressed={n === hl} onClick={() => setHl(hl === n ? -1 : n)} className="w-full whitespace-nowrap p-3 uppercase tracking-wider">{c}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_ROWS.map(([cap, cells]) => (
              <tr key={cap} className="border-t border-white/15">
                <td className="p-3 font-semibold">{cap}</td>
                {cells.map((v, n) => (
                  <td key={n} className={`p-3 text-center ${n === hl ? 'bg-sky-400/15' : ''} ${v ? 'font-extrabold text-green-300' : 'text-white/30'}`}>{v ? 'Yes' : '–'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-blue-100/70">Access is enforced on every request by the server, not only hidden on screen.</p>
    </>
  );
};

type Job = { n: number; kind: string; sent: boolean; cur: boolean };
const KINDS = ['Chart update', 'RPC visit 1', 'RPC visit 2', 'Appointment'] as const;

const SyncDemo = () => {
  const [online, setOnline] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('Go offline, record visits, then go online and sync.');
  const waiting = jobs.filter((j) => !j.sent).length;

  const add = () => {
    setJobs((j) => [...j, { n: j.length + 1, kind: KINDS[(j.length + 1) % 4], sent: false, cur: false }]);
    setNote(online ? 'Online: press Sync now to send.' : 'Offline: saved on this device.');
  };
  const sync = async () => {
    if (!online) { setNote('Still offline. The queue is kept as it is.'); return; }
    if (busy || waiting === 0) { if (!busy) setNote('Nothing to send.'); return; }
    setBusy(true);
    // FIFO: oldest first, one at a time.
    for (const job of jobs.filter((j) => !j.sent)) {
      setJobs((all) => all.map((j) => (j.n === job.n ? { ...j, cur: true } : j)));
      await new Promise((r) => setTimeout(r, 550));
      setJobs((all) => all.map((j) => (j.n === job.n ? { ...j, cur: false, sent: true } : j)));
    }
    setBusy(false);
    setNote('All sent in order, oldest first.');
  };

  return (
    <GlassCard>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-blue-100/70">
            <span>Try it</span>
            <button type="button" onClick={() => setOnline((v) => !v)} aria-pressed={!online}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-3 py-1 text-xs font-bold normal-case tracking-normal">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-400' : 'bg-amber-400'}`} />{online ? 'Online' : 'Offline'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={add} className="rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-bold text-[#06204A]">Record a visit</button>
            <button type="button" onClick={sync} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-bold">Sync now</button>
          </div>
          <p className="mt-3 text-xs text-blue-100/70" aria-live="polite">{note}</p>
        </div>
        <div>
          <div className="mb-2 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-blue-100/70"><span>Queue, oldest first</span><span>{waiting} waiting</span></div>
          {jobs.length === 0 && <div className="rounded-lg border border-white/15 px-3 py-2 text-sm text-blue-100/70">Nothing waiting.</div>}
          {jobs.map((j) => (
            <div key={j.n} className={`mt-1.5 flex justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition ${j.sent ? 'border-white/10 line-through opacity-45' : j.cur ? 'border-sky-400' : 'border-white/15'}`}>
              <span>{j.kind}</span><small className="text-blue-100/70">#{j.n}</small>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
};

export const LandingHome = () => {
  const [school, setSchool] = useState(0);
  return (
    <>
      {/* Hero */}
      <div className="mx-auto grid max-w-6xl items-center gap-9 px-5 pb-14 pt-14 md:grid-cols-[1.15fr_0.85fr] md:pt-20">
        <div>
          <Tag>Barangay Tanyag, Taguig City</Tag>
          <h1 className="mt-4 text-balance text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">
            Healthy smiles <span className="block text-sky-300">for every school year.</span>
          </h1>
          <p className="mt-4 max-w-[48ch] text-base text-blue-100/85 sm:text-lg">
            Floral keeps dental charts, appointments and two-visit RPC monitoring for three Tanyag schools. It works offline in the field and syncs when the connection returns.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5"><PrimaryLink to="/login">Sign in</PrimaryLink><SecondaryLink to="/about">See how it works</SecondaryLink></div>
        </div>
        <GlassCard className="shadow-2xl">
          <div className="mb-3 flex justify-between gap-2 border-b border-white/15 pb-2 text-[11px] font-semibold uppercase tracking-wider text-blue-100/70"><span>Individual Patient Treatment Record</span><span>Layout sample</span></div>
          {[['School', 'Assigned at sign-in'], ['RPC visit', 'Visit 1 or Visit 2'], ['Risk level', 'Validated by the dentist']].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-dashed border-white/15 py-1.5 text-sm"><span className="text-blue-100/70">{k}</span><b>{v}</b></div>
          ))}
          <p className="mt-3 text-xs text-blue-100/70">A sample of the layout only. No student data is shown on public pages.</p>
        </GlassCard>
      </div>

      {/* Facts: fixed properties of the system, not statistics */}
      <div className="border-y border-white/15 bg-white/[0.05]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-5 sm:grid-cols-4">
          {FACTS.map(([n, l]) => (
            <div key={l} className="border-white/15 px-2 py-4 sm:border-r sm:px-5 sm:last:border-r-0">
              <b className="block text-3xl font-extrabold tabular-nums">{n}</b><span className="text-sm text-blue-100/75">{l}</span>
            </div>
          ))}
        </div>
      </div>

      <Section alt>
        <SectionHead tag="How a student moves through Floral" title="From the paper form to the monthly report" lead="Five steps. Select one to see what staff do and what Floral records." />
        <FlowSection />
      </Section>

      <Section>
        <SectionHead title="Seven modules, one login" lead="Open any module to try a preview." />
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, n) => (
            <Link key={m.key} to={`/about?module=${n}`} className="group flex flex-col gap-1.5 rounded-2xl border border-white/15 bg-white/[0.07] p-5 transition hover:-translate-y-0.5 hover:border-sky-400">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/15 text-sm font-extrabold text-sky-300">{n + 1}</span>
              <h3 className="font-bold">{m.key}</h3>
              <p className="text-sm text-blue-100/75">{m.d}</p>
              <span className="mt-auto pt-2 text-xs font-bold text-sky-300">{'demo' in m ? 'Try it →' : 'Learn more →'}</span>
            </Link>
          ))}
        </div>
      </Section>

      <Section alt>
        <SectionHead tag="Roles" title="Everyone sees only what their job needs" lead="Select a role to highlight its access." />
        <AccessMatrix />
      </Section>

      <Section>
        <SectionHead tag="Built for the field" title="Keep working when the signal drops" lead="Floral saves changes on the device and sends them in the order they were made. If one fails, the queue stops and nothing is skipped." />
        <SyncDemo />
      </Section>

      <Section alt>
        <SectionHead tag="Privacy and safety" title="Student data is handled like clinic data" />
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {PRIVACY.map(([t, d], n) => (
            <GlassCard key={t}><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/15 font-extrabold text-sky-300">{n + 1}</span><h3 className="mb-1 mt-2.5 font-bold">{t}</h3><p className="text-sm text-blue-100/75">{d}</p></GlassCard>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Built for the people in the clinic</h2>
            <p className="mt-3 max-w-[48ch] text-blue-100/80">The dentist validates every treatment recommendation. Predictions assist the decision and never replace it.</p>
            <div className="mt-5"><PrimaryLink to="/clinic">Meet the clinic</PrimaryLink></div>
          </div>
          <div className="grid gap-2.5">
            {SCHOOLS.map((s, n) => (
              <button key={s.name} type="button" aria-pressed={n === school} onClick={() => setSchool(n)}
                className={`flex justify-between gap-3 rounded-2xl border bg-white/[0.07] px-4 py-3.5 text-left font-semibold ${n === school ? 'border-sky-400 ring-2 ring-sky-400/60' : 'border-white/15'}`}>
                {s.name}<span className="whitespace-nowrap font-medium text-blue-100/70">{s.grades}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>

      <div className="mx-auto max-w-6xl px-5 py-16 text-center">
        <h2 className="text-balance text-2xl font-extrabold tracking-tight sm:text-4xl">Ready to open the clinic's records?</h2>
        <p className="mx-auto mt-3 max-w-[48ch] text-blue-100/80">Sign in with the account the System Admin created for you.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5"><PrimaryLink to="/login">Sign in</PrimaryLink><SecondaryLink to="/clinic">Meet the clinic</SecondaryLink></div>
      </div>
    </>
  );
};
