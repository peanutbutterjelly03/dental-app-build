import { useMemo, useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { apiClient, ApiError } from '../../api/client';
import { formatDate } from '../../utils/localDate';
import { ageOn } from '../../utils/age';
import { treatmentCodes } from '../../../../shared/treatmentCodes';
import {
  suggestTreatments,
  riskFindings,
  confidenceLabel,
  SKIP_REASONS,
  type RiskLevel,
  type SuggestedTreatment,
  type SkipReason,
} from '../../../../shared/riskTreatments';
import type { RiskCandidate } from '../../../../shared/riskCandidates';

// The 4-step risk review (2026-10-01, the classmate's design; decisions in
// HANDOFF "PLANNED: Risk Classification redesign"). Used by Risk
// Classification and, in R3, straight from the Students list, so the review
// can never work differently depending on where it was opened.
//
// Saving VALIDATES: a stored suggestion is UPDATED (PUT); a pupil with no
// stored suggestion gets a new, already-validated row (POST). Only the dentist
// can save (SEC-35: the server refuses anyone else); others can read.
//
// ⚠ Nothing here changes the dental chart. An accepted treatment is saved as a
// recommendation on the review, exactly as the step 3 text says.

type Step = 1 | 2 | 3 | 4;
type Decision = { decision: 'accepted' | 'skipped'; reason: SkipReason | '' };

interface PredictionResult {
  risk_level: RiskLevel;
  confidence: number;
  recommendation: string;
}

const LEVEL_CHIP: Record<RiskLevel, string> = {
  High: 'bg-red-50 text-red-700 border-red-200',
  Medium: 'bg-amber-50 text-amber-800 border-amber-200',
  Low: 'bg-green-50 text-green-800 border-green-200',
};
const LEVEL_HELP: Record<RiskLevel, string> = {
  High: 'Higher chance of new cavities. Needs the most follow-up.',
  Medium: 'Some cavities or risk factors. Regular follow-up.',
  Low: 'Few or no cavities. Routine care.',
};
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Check the facts' },
  { n: 2, label: 'Confirm risk level' },
  { n: 3, label: 'Decide treatments' },
  { n: 4, label: 'Review & save' },
];

const keyOf = (t: SuggestedTreatment) => `${t.code}:${t.tooth ?? 'mouth'}`;
const nameOf = (code: string) => treatmentCodes.find((t) => t.code === code)?.label ?? code;
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export function LevelChip({ level }: { level: RiskLevel }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${LEVEL_CHIP[level]}`}>{level} risk</span>;
}

export function RiskReviewDialog({
  candidate,
  canSave,
  serviceDown,
  onClose,
  onSaved,
}: {
  candidate: RiskCandidate;
  /** The signed-in user is the dentist. */
  canSave: boolean;
  /** The prediction service is known to be asleep or unreachable. */
  serviceDown: boolean;
  onClose: () => void;
  /** Called after a successful save; the caller reloads its list. */
  onSaved: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  // The suggestion on record, or one checked just now in step 1.
  const [suggestion, setSuggestion] = useState(candidate.suggestion);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [level, setLevel] = useState<RiskLevel | null>(candidate.suggestion?.level ?? null);
  const [notes, setNotes] = useState('');
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { features, teeth, caries } = candidate;
  const findings = useMemo(() => riskFindings({
    teeth,
    sugarBeverages: features.sugar_beverages === 1,
    gingivitis: features.gingivitis === 1,
    calculus: features.calculus === 1,
  }), [teeth, features]);
  const treatments = useMemo(() => suggestTreatments(teeth, level), [teeth, level]);
  // DMF from the SAME charting the facts and findings come from.
  const dmf = useMemo(() => {
    const n = (codes: string[]) => teeth.filter((t) => codes.includes(t.condition)).length;
    return { d: n(['D', 'd']), m: n(['M', 'm']), f: n(['F', 'f']) };
  }, [teeth]);

  const age = ageOn(candidate.birthdate);
  const subtitle = [
    [candidate.grade, candidate.section].filter(Boolean).join(' · '),
    age !== null ? `Age ${age}` : null,
    candidate.latestVisitDate
      ? `${candidate.latestVisitNumber ? `Visit ${candidate.latestVisitNumber} · ` : 'Visit '}${formatDate(candidate.latestVisitDate)}`
      : null,
  ].filter(Boolean).join(' · ');

  const decided = treatments.filter((t) => {
    const d = decisions[keyOf(t)];
    return d && (d.decision === 'accepted' || d.reason !== '');
  }).length;
  const acceptedCount = treatments.filter((t) => decisions[keyOf(t)]?.decision === 'accepted').length;
  const skippedCount = treatments.filter((t) => decisions[keyOf(t)]?.decision === 'skipped').length;

  const canNext: Record<Step, boolean> = {
    1: true,
    2: level !== null && notes.trim().length > 0,
    3: decided === treatments.length,
    4: true,
  };

  // "Check risk now": ask the model, then STORE the answer as an unreviewed
  // suggestion, so it survives closing this dialog and shows as Needs review.
  const checkRisk = async () => {
    if (!candidate.latestPreventiveId) return;
    setChecking(true);
    setCheckError(null);
    try {
      const result = await apiClient.post<PredictionResult>('/predictions/assess', {
        student_id: candidate.id,
        features: candidate.features,
      });
      const saved = await apiClient.post<{ _id: string }>('/risk-stratifications', {
        preventive_id: candidate.latestPreventiveId,
        risk_level: result.risk_level,
        recommendation: result.recommendation ?? '',
        dmf_score: candidate.features.dmf_score,
        dmf_index: candidate.dmfIndex,
        validated_by_dentist: false,
        model_risk_level: result.risk_level,
        model_confidence: result.confidence,
      });
      setSuggestion({ id: saved._id, level: result.risk_level, confidence: result.confidence });
      setLevel(result.risk_level);
    } catch (err) {
      setCheckError(err instanceof ApiError && (err.status === 503 || err.status === 504)
        ? 'The prediction service is asleep or unreachable. Try again in a minute, or choose the level yourself in the next step.'
        : err instanceof ApiError ? err.message : 'Could not check the risk. Try again, or choose the level yourself.');
    } finally {
      setChecking(false);
    }
  };

  const decide = (t: SuggestedTreatment, decision: Decision['decision']) =>
    setDecisions((prev) => ({ ...prev, [keyOf(t)]: { decision, reason: decision === 'skipped' ? (prev[keyOf(t)]?.reason ?? '') : '' } }));
  const acceptAll = () =>
    setDecisions((prev) => Object.fromEntries(treatments.map((t) => [keyOf(t), prev[keyOf(t)]?.decision === 'skipped' ? prev[keyOf(t)] : { decision: 'accepted', reason: '' }])));

  const save = async () => {
    if (!canSave || !level || !candidate.latestPreventiveId) return;
    setSaving(true);
    setSaveError(null);
    const treatment_decisions = treatments.map((t) => {
      const d = decisions[keyOf(t)];
      return { code: t.code, tooth: t.tooth, decision: d.decision, skip_reason: d.decision === 'skipped' ? d.reason : null };
    });
    const describe = (d: typeof treatment_decisions[number]) => `${d.code}${d.tooth ? ` ${d.tooth}` : ' (whole mouth)'}`;
    const accepted = treatment_decisions.filter((d) => d.decision === 'accepted').map(describe);
    const skipped = treatment_decisions.filter((d) => d.decision === 'skipped').map((d) => `${describe(d)} (${d.skip_reason})`);
    const recommendation = [
      accepted.length ? `Accepted: ${accepted.join(', ')}.` : 'No treatments accepted.',
      skipped.length ? `Skipped: ${skipped.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    const review = {
      risk_level: level,
      recommendation,
      validated_by_dentist: true,
      validated_at: new Date().toISOString(),
      dentist_notes: notes.trim(),
      treatment_decisions,
    };
    try {
      if (suggestion) {
        // Record what the system suggested, so the audit line and step 4 agree.
        // Rows stored before 2026-10-01 carry the suggestion only in risk_level,
        // which this save is about to overwrite with the dentist's level.
        await apiClient.put(`/risk-stratifications/${suggestion.id}`, { ...review, model_risk_level: suggestion.level });
      } else {
        await apiClient.post('/risk-stratifications', {
          ...review,
          preventive_id: candidate.latestPreventiveId,
          dmf_score: candidate.features.dmf_score,
          dmf_index: candidate.dmfIndex,
          model_risk_level: null,
          model_confidence: null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the review. Nothing was saved; try again.');
    } finally {
      setSaving(false);
    }
  };

  const conf = confidenceLabel(suggestion?.confidence);

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl" rounded="rounded-2xl" closeDisabled={saving}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Review risk result</div>
          <h2 className="mt-1 text-2xl font-bold text-foreground">{candidate.name}</h2>
          <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Stepper: scrolls sideways on a phone instead of wrapping */}
      <div className="mt-5 overflow-x-auto border-b border-border px-6 pb-4">
        <ol className="flex min-w-max items-center gap-6">
          {STEPS.map(({ n, label }) => {
            const done = n < step;
            const current = n === step;
            return (
              <li key={n} className="flex items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold ${done ? 'border-primary bg-primary text-white' : current ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                  {done ? <Check className="h-4 w-4" /> : n}
                </span>
                <span className={`text-sm ${current ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="px-6 py-5">
        {step === 1 && (
          <div className="space-y-5">
            <section>
              <h3 className="mb-3 text-base font-bold text-foreground">What the dental chart shows</h3>
              {teeth.length === 0 ? (
                <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">No charting recorded for the latest school year yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ['With caries experience', yesNo(caries.withCariesExperience)],
                    ['In temporary teeth', yesNo(caries.inTemporaryTeeth)],
                    ['In permanent dentition', yesNo(caries.inPermanentDentition)],
                    ['With active caries', yesNo(caries.withActiveCaries)],
                    ['Caries-free teeth', caries.cariesFreeTeeth === null ? '—' : String(caries.cariesFreeTeeth)],
                    ['DMF (decayed / missing / filled)', `${dmf.d} / ${dmf.m} / ${dmf.f}`],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted/60 px-4 py-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="mt-2 text-xl font-bold text-foreground">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-base font-bold text-foreground">What the system suggests</h3>
              {suggestion ? (
                <div className="flex flex-wrap items-center gap-2">
                  <LevelChip level={suggestion.level} />
                  {conf && <span className="text-sm text-muted-foreground">{conf}</span>}
                </div>
              ) : !candidate.latestPreventiveId ? (
                <p className="text-sm text-muted-foreground">No RPC visit recorded yet, so there is nothing to attach a result to.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">No suggestion yet for the latest visit.</p>
                  {canSave && (
                    <button type="button" onClick={checkRisk} disabled={checking}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60">
                      {checking && <Loader2 className="h-4 w-4 animate-spin" />}
                      {checking ? 'Checking...' : 'Check risk now'}
                    </button>
                  )}
                  {(checkError || (serviceDown && !checking)) && (
                    <p className="text-sm text-amber-800">{checkError ?? 'The prediction service is asleep right now. You can still choose the level yourself in the next step.'}</p>
                  )}
                </div>
              )}
              {findings.length > 0 && (
                <div className="mt-3">
                  {/* "Findings", not "Reasons": real facts from the chart and
                      forms. The model does not explain one pupil's result. */}
                  <div className="text-sm text-muted-foreground">Findings:</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                    {findings.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-bold text-foreground">
                {suggestion ? `Is ${suggestion.level} risk right for this student?` : 'Choose the risk level for this student'}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {suggestion
                  ? <>The system suggested <strong>{suggestion.level}</strong>. Keep it, or choose a different level.</>
                  : 'There is no system suggestion, so the level is entirely your call.'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['High', 'Medium', 'Low'] as RiskLevel[]).map((l) => (
                <button key={l} type="button" onClick={() => setLevel(l)} aria-pressed={level === l}
                  className={`rounded-xl border-2 p-4 text-left transition-colors ${level === l ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/40'}`}>
                  <LevelChip level={l} />
                  <p className="mt-2 text-sm text-muted-foreground">{LEVEL_HELP[l]}</p>
                  {suggestion?.level === l && <p className="mt-2 text-sm font-bold text-primary">System suggestion</p>}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="risk-notes" className="text-sm font-bold text-foreground">Your notes (required)</label>
              <textarea id="risk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder={suggestion ? 'Why do you agree, or why did you change it?' : 'Why this level?'}
                className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-foreground">
                Treatments to consider <span className="text-sm font-semibold text-muted-foreground">{decided} of {treatments.length} decided</span>
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Only treatments from the dental chart are offered. Accepting one saves it as a recommendation. It does not change the chart.
              </p>
            </div>
            {treatments.length === 0 ? (
              <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">No treatments to decide: the chart shows no decayed teeth, and the level you chose does not call for fluoride varnish.</p>
            ) : (
              <>
                {treatments.map((t) => {
                  const d = decisions[keyOf(t)];
                  return (
                    <div key={keyOf(t)} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="rounded-md bg-muted px-2 py-1 text-sm font-semibold text-foreground">{t.code}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-foreground">
                            {nameOf(t.code)} <span className="text-muted-foreground">· {t.tooth ? `Tooth ${t.tooth}` : 'Whole mouth'}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">Why: {t.why}</div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => decide(t, 'accepted')} aria-pressed={d?.decision === 'accepted'}
                            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold ${d?.decision === 'accepted' ? 'border-green-300 bg-green-50 text-green-700' : 'border-border text-foreground hover:bg-muted'}`}>
                            Accept
                          </button>
                          <button type="button" onClick={() => decide(t, 'skipped')} aria-pressed={d?.decision === 'skipped'}
                            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold ${d?.decision === 'skipped' ? 'border-red-300 bg-red-50 text-red-700' : 'border-border text-foreground hover:bg-muted'}`}>
                            Skip
                          </button>
                        </div>
                      </div>
                      {d?.decision === 'skipped' && (
                        <select value={d.reason} aria-label={`Why skip ${nameOf(t.code)}`}
                          onChange={(e) => setDecisions((prev) => ({ ...prev, [keyOf(t)]: { decision: 'skipped', reason: e.target.value as SkipReason } }))}
                          className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="">Why skip this? (required)</option>
                          {SKIP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={acceptAll} className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                  Accept all
                </button>
              </>
            )}
          </div>
        )}

        {step === 4 && level && (
          <div>
            <h3 className="mb-2 text-base font-bold text-foreground">Please check before saving</h3>
            <dl className="divide-y divide-border">
              {([
                ['Student', <span key="s" className="font-semibold">{candidate.name}</span>],
                ['Risk level', (
                  <span key="l" className="inline-flex flex-wrap items-center justify-end gap-2">
                    <LevelChip level={level} />
                    <span className="text-sm text-muted-foreground">
                      {!suggestion ? 'chosen by you (no system suggestion)' : suggestion.level === level ? 'as the system suggested' : `changed from ${suggestion.level}`}
                    </span>
                  </span>
                )],
                ['Your notes', <span key="n" className="break-words">{notes.trim()}</span>],
                ['Treatments accepted', <span key="a" className="font-semibold">{acceptedCount}</span>],
                ['Treatments skipped', <span key="k" className="font-semibold">{skippedCount}</span>],
                ['Still to decide', <span key="d" className="font-semibold">{treatments.length - decided}</span>],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">
              {canSave ? 'Saving records this review under your name in the audit trail.' : 'Only the dentist can save a risk review. You can read it, but saving is left to the dentist.'}
            </p>
            {saveError && <p className="mt-2 text-sm text-destructive" role="alert">{saveError}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
        <button type="button" onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as Step))} disabled={saving}
          className="rounded-xl border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-muted">
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 4 ? (
          <button type="button" onClick={() => setStep((s) => (s + 1) as Step)} disabled={!canNext[step]}
            className="rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
            Next
          </button>
        ) : canSave ? (
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save review'}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
