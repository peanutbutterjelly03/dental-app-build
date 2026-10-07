import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { DOH_AGE_BRACKETS } from '../../../../shared/age';
import { MODULES } from './publicContent';
import { RiskDemo, RpcDemo, ToothChartDemo } from './Demos';
import { GlassCard, Section, SectionHead, Tag } from './PublicLayout';

const ALGORITHMS = ['Logistic Regression', 'Decision Tree', 'Random Forest', 'SVM', 'XGBoost'] as const;

const PIPELINE = [
  ['Inputs', 'DMF and dmf index first, then oral health conditions, diet, medical history and treatment history.'],
  ['Model', 'Five algorithms are compared and the best one by F1 score is used.'],
  ['Suggestion', 'High, Medium or Low, shown with the treatment it points to.'],
  ['Dentist', 'Validates or changes it. The decision and the person are recorded.'],
] as const;

export const AboutFloral = () => {
  const [params] = useSearchParams();
  const fromLink = Number(params.get('module'));
  const [cur, setCur] = useState(Number.isInteger(fromLink) && fromLink >= 0 && fromLink < MODULES.length ? fromLink : 2);
  const m = MODULES[cur];

  return (
    <>
      <Section>
        <SectionHead tag="About Floral" title="Seven modules, one record per student" lead="Pick a module. Three of them have a working preview." />
        <div className="grid items-start gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <div role="tablist" aria-label="Modules" className="flex gap-1 overflow-x-auto pb-1.5 md:flex-col md:overflow-visible">
            {MODULES.map((x, n) => (
              <button key={x.key} role="tab" aria-selected={n === cur} onClick={() => setCur(n)}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 py-2.5 text-left text-sm ${n === cur ? 'border-sky-400 bg-white/10 font-bold' : 'border-transparent font-medium hover:bg-white/5'}`}>
                <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-sky-400/15 text-[11px] font-extrabold text-sky-300">{n + 1}</span>{x.key}
              </button>
            ))}
          </div>
          <GlassCard className="min-h-[380px]">
            <Tag>Module {cur + 1} of {MODULES.length}</Tag>
            <h3 className="mt-3 text-2xl font-bold">{m.key}</h3>
            <p className="mt-1 max-w-[56ch] text-blue-100/80">{m.d}</p>
            <ul className="mt-4 grid gap-2">
              {m.b.map((x) => <li key={x} className="flex gap-2.5 text-sm text-blue-100/80"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />{x}</li>)}
            </ul>
            {'demo' in m && m.demo === 'chart' && <ToothChartDemo />}
            {'demo' in m && m.demo === 'rpc' && <RpcDemo />}
            {'demo' in m && m.demo === 'risk' && <RiskDemo />}
          </GlassCard>
        </div>
      </Section>

      <Section alt>
        <SectionHead tag="Risk analytics" title="A second opinion for the dentist" lead="The model reads the chart and suggests a caries risk level. The dentist confirms or changes it before anything is done clinically." />
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map(([t, d]) => (
            <GlassCard key={t} className="p-4">
              <b className="mb-1.5 block text-[11px] uppercase tracking-wider text-sky-300">{t}</b>
              <p className="text-sm text-blue-100/75">{d}</p>
              {t === 'Model' && <div className="mt-2 flex flex-wrap gap-1.5">{ALGORITHMS.map((a) => <span key={a} className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs">{a}</span>)}</div>}
            </GlassCard>
          ))}
        </div>
        <p className="mt-3 text-xs text-blue-100/70">Pilot stage. Student names are never sent to the model.</p>
      </Section>

      <Section>
        <SectionHead tag="Reports" title="The DOH form keeps every row and column" lead="Reports follow the official layout. Cells fill from the database after sign-in, and a cell with no data stays blank." />
        <div className="overflow-x-auto rounded-2xl border border-white/15 bg-white/[0.07]">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead><tr>{['Age bracket', 'Male', 'Female', 'Total'].map((h, n) => <th key={h} className={`border border-white/15 p-2.5 text-xs font-semibold text-blue-100/75 ${n === 0 ? 'text-left' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              {DOH_AGE_BRACKETS.map((b) => (
                <tr key={b}><td className="border border-white/15 p-2.5 font-medium">{b}</td><td className="h-9 border border-white/15" /><td className="border border-white/15" /><td className="border border-white/15" /></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-blue-100/70">Layout sample with the DOH age brackets. The real reports have more columns and are available after sign-in.</p>
      </Section>
    </>
  );
};
