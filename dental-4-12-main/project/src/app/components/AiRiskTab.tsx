import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Brain } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useRiskClassification } from '../hooks/useRiskClassification';
import type { ApiPreventiveCareRecord } from '../api/types';
import { suggestTreatments, type RiskLevel } from '../../../shared/riskTreatments';

// The Caries Risk Assessment tab (user pick "1, one page top to bottom", 2026-10-05).
// Read-only: the review itself (generate, confirm, treatments) is the Risk
// Classification page's job, and this tab opens it for this student.
//
// ⚠ The model gives RISK ONLY. Treatments are the fixed rules in
// shared/riskTreatments.ts. The "what the system looked at" panel lists the
// model's INPUTS and is deliberately not called "reasons": the model does not
// explain an individual answer. A tooth nobody charted is never counted as
// healthy (caries-free figure comes from `caries`, which only counts teeth
// charted sound). The synthetic-data sentence must not be softened.

interface RiskRow {
  _id: string;
  risk_level: RiskLevel;
  validated_by_dentist: boolean;
  validated_at: string | null;
  model_risk_level: RiskLevel | null;
  model_confidence: number | null;
  dentist_notes?: string;
  treatment_decisions?: { code: string; tooth: number | null; decision: 'accepted' | 'skipped'; skip_reason: string | null }[];
}

const PILL: Record<RiskLevel, string> = {
  High: 'border-red-300 bg-red-100 text-red-700',
  Medium: 'border-amber-300 bg-amber-100 text-amber-800',
  Low: 'border-green-300 bg-green-100 text-green-800',
};
const LINE: Record<RiskLevel, string> = { High: '#F87171', Medium: '#F59E0B', Low: '#4ADE80' };
const TREATMENT_NAME: Record<string, string> = { FV: 'Fluoride varnish', PF: 'Permanent filling', SDF: 'Silver diamine fluoride' };

const longDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const Pill = ({ level, big }: { level: RiskLevel | null; big?: boolean }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-bold ${big ? 'px-4 py-1.5 text-lg' : 'px-2.5 py-0.5 text-xs'} ${level ? PILL[level] : 'border-slate-300 bg-slate-100 text-slate-700'}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
    {level ? `${level} risk` : 'No result'}
  </span>
);

const Chip = ({ tone, children }: { tone?: 'ok' | 'warn'; children: React.ReactNode }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone === 'ok' ? 'border-green-300 bg-green-100 text-green-800' : tone === 'warn' ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-border bg-muted/40 text-foreground'}`}>{children}</span>
);

const Panel = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-3.5">
    <h3 className="text-[13px] font-bold text-foreground">{title}</h3>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    {children}
  </div>
);

const YesNo = ({ yes }: { yes: boolean }) => (
  <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] font-extrabold ${yes ? 'border-red-300 bg-red-100 text-red-700' : 'border-green-300 bg-green-100 text-green-800'}`}>{yes ? 'Yes' : 'No'}</span>
);

interface Props {
  studentId: string;
  studentName: string;
  gradeSection: string;
  age: number | null;
  /** The school year on screen and its two RPC visit records, for the services table. */
  schoolYear: string;
  visits: Partial<Record<1 | 2, ApiPreventiveCareRecord>>;
  /** Only the dentist reviews. */
  canReview: boolean;
  onOpenTab: (tab: 'chart' | 'treatments') => void;
}

export function AiRiskTab({ studentId, studentName, gradeSection, age, schoolYear, visits, canReview, onOpenTab }: Props) {
  const navigate = useNavigate();
  const { selectedSchool } = useAuth();
  const { candidates, loading, error } = useRiskClassification({ studentId, school: selectedSchool ?? '' });
  const cand = candidates[0] ?? null;

  // The latest visit's stored rows: the model's level and confidence, the
  // dentist's note and decisions. The list endpoint leaves the note out on purpose.
  const [rows, setRows] = useState<RiskRow[]>([]);
  const latestVisitId = cand?.latestPreventiveId ?? null;
  useEffect(() => {
    if (!latestVisitId) { setRows([]); return; }
    let cancelled = false;
    apiClient.get<RiskRow[]>(`/risk-stratifications?preventive_id=${latestVisitId}`)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [latestVisitId, cand?.status]);

  const view = useMemo(() => {
    if (!cand) return null;
    const validated = rows.filter((r) => r.validated_by_dentist);
    const last = validated[validated.length - 1] ?? null;
    const reviewed = cand.status === 'reviewed';
    const waiting = cand.status === 'needs_review';
    const finalLevel: RiskLevel | null = reviewed ? (last?.risk_level ?? cand.history[cand.history.length - 1]?.riskLevel ?? null) : null;
    const modelLevel: RiskLevel | null = reviewed ? (last?.model_risk_level ?? null) : waiting ? cand.suggestion?.level ?? null : null;
    const confidence = reviewed ? last?.model_confidence ?? null : waiting ? cand.suggestion?.confidence ?? null : null;
    const shown = finalLevel ?? modelLevel;
    return { reviewed, waiting, last, finalLevel, modelLevel, confidence, shown };
  }, [cand, rows]);

  if (loading && !cand) return <div className="p-6 text-sm text-muted-foreground" aria-busy="true">Loading the risk assessment</div>;
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (!cand || !view) {
    return (
      <div className="p-4">
        <div className="py-12 text-center text-muted-foreground">
          <Brain className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm font-medium">No risk information for this student yet</p>
        </div>
      </div>
    );
  }

  const noVisit = cand.status === 'no_visit';
  const f = cand.features;
  const idx = cand.dmfIndex;
  const yesNo = (v: 0 | 1) => (v ? 'Yes' : 'No');

  // Trend: every validated result, plus the waiting suggestion as a hollow point.
  const points: { date: string; level: RiskLevel; reviewed: boolean; score: number | null }[] = [
    ...cand.history.map((h) => ({ date: h.visitDate, level: h.riskLevel, reviewed: true, score: h.dmfScore })),
    ...(view.waiting && cand.suggestion && cand.latestVisitDate
      ? [{ date: cand.latestVisitDate.slice(0, 10), level: cand.suggestion.level, reviewed: false, score: f.dmf_score }]
      : []),
  ];
  const order: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const cur = points.length ? points[points.length - 1] : null;
  const change = prev && cur ? order[cur.level] - order[prev.level] : 0;
  const xAt = (i: number) => (points.length > 1 ? 60 + (i * 300) / (points.length - 1) : 210);
  const yAt = (l: RiskLevel) => ({ Low: 150, Medium: 90, High: 30 }[l]);

  const decisions = view.last?.treatment_decisions ?? [];
  const suggestions = view.shown && !view.reviewed ? suggestTreatments(cand.teeth, view.shown) : [];

  const services: [keyof ApiPreventiveCareRecord, string][] = [
    ['oral_screening', 'Oral screening'], ['oral_prophylaxis', 'Oral prophylaxis'], ['fluoride_varnish', 'Fluoride varnish'],
    ['oral_hygiene_instruction', 'Oral hygiene instruction'], ['consultation', 'Consultation'],
  ];
  const svcCell = (v: ApiPreventiveCareRecord | undefined, k: keyof ApiPreventiveCareRecord) =>
    !v ? <span className="text-muted-foreground">No visit</span> : v[k] === true ? <span className="font-extrabold text-green-700">&#10003;</span> : <span className="text-muted-foreground">Not recorded</span>;

  const dohCols: [string, React.ReactNode][] = [
    ['With Caries Experience', <YesNo key="a" yes={cand.caries.withCariesExperience} />],
    ['With Caries Experience in Temporary Teeth', <YesNo key="b" yes={cand.caries.inTemporaryTeeth} />],
    ['With Caries Experience in Permanent Dentition', <YesNo key="c" yes={cand.caries.inPermanentDentition} />],
    ['With Active Dental Caries', <YesNo key="d" yes={cand.caries.withActiveCaries} />],
    ['Number of Caries Free Teeth', <span key="e" className="inline-block rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-base font-extrabold">{cand.caries.cariesFreeTeeth ?? 'Not recorded'}</span>],
  ];

  const toRisk = () => navigate(`/ai-analytics?student=${studentId}`);

  return (
    <div className="space-y-3.5 p-4">
      {/* Who and which result this is based on */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold text-foreground">{studentName}</div>
          <div className="text-xs text-muted-foreground">{[gradeSection, age != null ? `${age} years` : '', `School year ${schoolYear}`].filter(Boolean).join(' · ')}</div>
        </div>
        <Chip>{noVisit ? 'Based on the chart' : `Based on ${cand.latestVisitNumber ? `Visit ${cand.latestVisitNumber}, ` : ''}${longDate(cand.latestVisitDate)}`}</Chip>
      </div>

      {/* The result */}
      {view.shown ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1.5">
              <Pill level={view.shown} big />
              <div>{view.reviewed
                ? <Chip tone="ok">Reviewed by the dentist{view.last?.validated_at ? `, ${longDate(view.last.validated_at)}` : ''}</Chip>
                : <Chip tone="warn">Waiting for the dentist</Chip>}</div>
            </div>
            {canReview && (
              <button type="button" onClick={toRisk}
                className={`rounded-lg px-3.5 py-2 text-[13px] font-bold ${view.reviewed ? 'border border-border bg-card text-foreground hover:bg-muted' : 'bg-primary text-white hover:bg-primary-hover'}`}>
                {view.reviewed ? 'Open in Risk Classification' : 'Review and confirm'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {view.reviewed && view.modelLevel && view.finalLevel !== view.modelLevel
              ? <><span>System suggested</span><Pill level={view.modelLevel} /><span className="text-muted-foreground">then the dentist set</span><Pill level={view.finalLevel} /></>
              : view.reviewed && view.modelLevel
                ? <span>System suggested {view.modelLevel}. The dentist confirmed it.</span>
                : !view.reviewed
                  ? <span>Suggested by the system{view.confidence != null ? `, ${Math.round(view.confidence * 100)}% sure` : ''}. Not counted until reviewed.</span>
                  : null}
          </div>
          {view.last?.dentist_notes?.trim() && (
            <div className="rounded-r-lg border-l-[3px] border-primary bg-muted/40 px-3 py-1.5 text-[13px]">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Dentist's note</div>
              {view.last.dentist_notes}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
          <div><Chip>{noVisit ? 'No RPC visit yet' : 'Not checked yet'}</Chip></div>
          <div className="text-sm font-bold">{noVisit ? 'A risk result belongs to an RPC visit.' : `No result for ${cand.latestVisitNumber ? `Visit ${cand.latestVisitNumber}` : 'the latest visit'} yet.`}</div>
          <p className="mx-auto max-w-prose text-xs text-muted-foreground">
            {noVisit ? 'Record Visit 1 in RPC Monitoring first. The result appears here afterwards. The chart facts below are already available.'
              : 'The system reads the chart, the oral health form and the diet answers, then suggests a level for the dentist to review.'}
          </p>
          {canReview && !noVisit && <button type="button" onClick={toRisk} className="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-bold text-white hover:bg-primary-hover">Check this student</button>}
          {noVisit && <button type="button" onClick={() => navigate('/rpc')} className="rounded-lg border border-border bg-card px-3.5 py-2 text-[13px] font-semibold hover:bg-muted">Go to RPC Monitoring</button>}
        </div>
      )}

      {/* Trend */}
      {points.length > 0 && (
        <div className="grid gap-3.5 lg:grid-cols-2">
          <Panel title="Level at each assessment">
            <div className="flex min-h-6 flex-wrap gap-2">
              {change > 0 && <Chip tone="warn">Higher than the one before</Chip>}
              {change < 0 && <Chip tone="ok">Lower than the one before</Chip>}
              {points.length > 1 && change === 0 && <Chip>Same as the one before</Chip>}
            </div>
            <svg viewBox="0 0 420 190" className="h-auto max-h-48 w-full" role="img" aria-label="Risk level at each assessment">
              <g stroke="var(--border)"><line x1="50" x2="410" y1="30" y2="30" /><line x1="50" x2="410" y1="90" y2="90" /><line x1="50" x2="410" y1="150" y2="150" /></g>
              <g fontSize="11" fill="var(--muted-foreground)"><text x="0" y="34">High</text><text x="0" y="94">Medium</text><text x="0" y="154">Low</text></g>
              <path d={points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i)} ${yAt(p.level)}`).join(' ')} fill="none" stroke="#273A78" strokeWidth="2.5" />
              {points.map((p, i) => (
                <g key={`${p.date}-${i}`}>
                  <circle cx={xAt(i)} cy={yAt(p.level)} r="7" fill={p.reviewed ? LINE[p.level] : 'var(--card)'} stroke={LINE[p.level]} strokeWidth="3" />
                  <text x={xAt(i)} y="178" fontSize="11" textAnchor="middle" fill="var(--muted-foreground)">{shortDate(p.date)}</text>
                </g>
              ))}
            </svg>
            <p className="text-xs text-muted-foreground">Filled dot: reviewed. Hollow dot: waiting for the dentist.</p>
          </Panel>
          <Panel title="Assessments">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">{idx}</th><th className="px-2 py-1.5">Level</th><th className="px-2 py-1.5">Status</th></tr></thead>
                <tbody>
                  {[...points].reverse().map((p, i) => (
                    <tr key={`${p.date}-${i}`} className="border-t border-border align-top">
                      <td className="px-2 py-1.5">{longDate(p.date)}</td>
                      <td className="px-2 py-1.5">{p.score ?? ''}</td>
                      <td className="px-2 py-1.5"><Pill level={p.level} /></td>
                      <td className="px-2 py-1.5 text-muted-foreground">{p.reviewed ? 'Reviewed' : 'Waiting for review'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* Caries experience, worded as on the DOH form */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b-2 border-border p-2.5 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground">Caries experience</div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[40rem] grid-cols-5">
            {dohCols.map(([cap, val], i) => (
              <div key={cap} className={`space-y-2 p-3 ${i ? 'border-l border-border' : ''}`}>
                <div className="text-xs leading-snug text-muted-foreground">{cap}</div>
                {val}
              </div>
            ))}
          </div>
        </div>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">From the latest chart. Experience means decayed, missing or filled, so a treated tooth still counts. Active means decayed right now. Only teeth marked sound are counted as caries free.</p>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {([[`${idx} score`, f.dmf_score, ''], ['Decayed', f.decayed_count, f.decayed_count ? 'text-red-600' : ''], ['Missing', f.missing_count, ''], ['Filled', f.filled_count, '']] as [string, number, string][]).map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{l}</div>
            <div className={`text-2xl font-extrabold tabular-nums ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel title="What the system looked at" hint="The facts it received for this student. The model does not explain its own answer, so these are inputs, not reasons.">
          {([
            ['Oral health', [['Gingivitis', yesNo(f.gingivitis)], ['Periodontal disease', yesNo(f.periodontal_disease)], ['Debris', yesNo(f.debris)], ['Calculus', yesNo(f.calculus)], ['Abnormal growth', yesNo(f.abnormal_growth)]]],
            ['Diet and habits', [['Sugary drinks', yesNo(f.sugar_beverages)], ['Tobacco use', yesNo(f.tobacco_user)]]],
            ['About the child', [['Age', `${f.age} years`], ['Sex', f.sex === 1 ? 'Male' : 'Female']]],
          ] as [string, [string, string][]][]).map(([group, items]) => (
            <div key={group} className="space-y-1.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-1.5">
                {items.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12.5px]">
                    <span>{k}</span><b className={v === 'Yes' ? 'text-red-600' : 'font-semibold text-muted-foreground'}>{v}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </Panel>

        <div className="grid min-w-0 content-start gap-3.5">
          <Panel title={view.reviewed ? 'Treatment decisions' : 'Treatments to confirm'}
            hint={view.reviewed ? 'What the dentist decided at the review.' : view.shown ? 'Suggested by fixed rules. The dentist accepts or skips each one.' : undefined}>
            {view.reviewed
              ? (decisions.length
                ? decisions.map((d, i) => (
                  <div key={`${d.code}-${d.tooth}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                    <span className="rounded-md bg-primary-surface px-2 py-0.5 text-[11px] font-extrabold text-primary">{d.code}</span>
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{TREATMENT_NAME[d.code] ?? d.code}</div><div className="text-xs text-muted-foreground">{d.tooth ? `Tooth ${d.tooth}` : 'Whole mouth'}</div></div>
                    {d.decision === 'accepted' ? <Chip tone="ok">Accepted</Chip> : <Chip tone="warn">{`Skipped${d.skip_reason ? `: ${d.skip_reason}` : ''}`}</Chip>}
                  </div>))
                : <p className="text-xs text-muted-foreground">No treatment decisions were recorded with this review.</p>)
              : suggestions.length
                ? suggestions.map((s, i) => (
                  <div key={`${s.code}-${s.tooth}-${i}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                    <span className="rounded-md bg-primary-surface px-2 py-0.5 text-[11px] font-extrabold text-primary">{s.code}</span>
                    <div className="min-w-0"><div className="text-[13px] font-semibold">{TREATMENT_NAME[s.code]}</div><div className="text-xs text-muted-foreground">{s.why}</div></div>
                  </div>))
                : <p className="text-xs text-muted-foreground">{view.shown ? 'The rules suggest no treatment for this student.' : 'Treatments are suggested after the system has checked the student.'}</p>}
          </Panel>

          <Panel title={`Done at each RPC visit, ${schoolYear}`} hint="A blank means no answer was recorded, not that the service was withheld.">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground"><th className="px-2 py-1.5">Service</th><th className="px-2 py-1.5">Visit 1</th><th className="px-2 py-1.5">Visit 2</th></tr></thead>
                <tbody>{services.map(([k, label]) => (
                  <tr key={k} className="border-t border-border"><td className="px-2 py-1.5">{label}</td><td className="px-2 py-1.5">{svcCell(visits[1], k)}</td><td className="px-2 py-1.5">{svcCell(visits[2], k)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Related records">
        <div className="flex flex-wrap gap-1.5">
          {([['Dental Chart tab', () => onOpenTab('chart')], ['Treatment tab', () => onOpenTab('treatments')], ['RPC Monitoring', () => navigate('/rpc')], ['Risk Classification page', toRisk]] as [string, () => void][]).map(([label, go]) => (
            <button key={label} type="button" onClick={go} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-primary hover:bg-muted">{label}</button>
          ))}
        </div>
      </Panel>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">Computer-assisted screening, not a diagnosis. Nothing counts until the dentist reviews it. The model is trained on placeholder data until real IPTR records are available.</p>
    </div>
  );
}
