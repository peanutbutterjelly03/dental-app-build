import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { Modal } from '../Modal';
import { apiClient } from '../../api/client';
import { formatDate } from '../../utils/localDate';
import { LevelChip, RiskReviewDialog } from './RiskReviewDialog';
import { riskFindings, confidenceLabel } from '../../../../shared/riskTreatments';
import type { RiskCandidate, RiskListPage } from '../../../../shared/riskCandidates';
import type { StudentRow } from '../../hooks/useStudents';

// The Risk column on the Students list (R3, 2026-10-01, the classmate's
// design). The chip reads the row's `riskReview`, computed by the SAME shared
// rule as Risk Classification, so the two screens cannot disagree.
//
// "Needs review" opens a small card; "Review now" opens the SAME 4-step
// review Risk Classification uses, fetched fresh for this one pupil.

const LEVEL_TEXT = { High: 'text-red-700', Medium: 'text-amber-800', Low: 'text-green-800' } as const;

export function StudentRiskChip({
  studentId,
  review,
  canSave,
  onSaved,
}: {
  studentId: string;
  review: StudentRow['riskReview'];
  /** The signed-in user is the dentist (SEC-35: the server refuses others). */
  canSave: boolean;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<RiskCandidate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  if (!review) return null;

  if (review.status === 'reviewed' && review.level) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <LevelChip level={review.level} />
        <span className="whitespace-nowrap text-xs text-green-700">✓ Reviewed{review.reviewedAt ? ` · ${formatDate(review.reviewedAt)}` : ''}</span>
      </div>
    );
  }
  if (review.status === 'not_checked') return <span className="whitespace-nowrap text-xs text-muted-foreground">Not checked yet</span>;
  if (review.status === 'no_visit') return <span className="whitespace-nowrap text-xs text-muted-foreground">No visit yet</span>;

  const openCard = async () => {
    setOpen(true);
    setLoadError(null);
    try {
      const page = await apiClient.get<RiskListPage>(`/stats/risk-candidates?student_id=${encodeURIComponent(studentId)}&limit=1`);
      setCandidate(page.rows[0] ?? null);
      if (!page.rows[0]) setLoadError('This student is not on the risk list.');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the risk result.');
    }
  };
  const close = () => { setOpen(false); setCandidate(null); };

  const findings = candidate
    ? riskFindings({
        teeth: candidate.teeth,
        sugarBeverages: candidate.features.sugar_beverages === 1,
        gingivitis: candidate.features.gingivitis === 1,
        calculus: candidate.features.calculus === 1,
      })
    : [];
  const conf = confidenceLabel(candidate?.suggestion?.confidence);

  return (
    <>
      <button
        type="button"
        onClick={openCard}
        className="flex flex-col items-start gap-0.5 text-left"
        aria-label={`Needs review${review.level ? `, suggested ${review.level} risk` : ''}. Open details`}
      >
        <span className={`inline-flex items-center rounded-full border border-dashed border-amber-400 bg-card px-2.5 py-0.5 text-sm font-semibold ${review.level ? LEVEL_TEXT[review.level] : 'text-muted-foreground'}`}>
          {review.level ? `${review.level} risk` : 'No level'}
        </span>
        <span className="whitespace-nowrap text-xs font-medium text-amber-800">Needs review</span>
      </button>

      {open && !reviewing && (
        <Modal onClose={close} maxWidth="max-w-md" rounded="rounded-2xl">
          <div className="space-y-4 p-6">
            {!candidate && !loadError && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
            )}
            {loadError && <p className="text-sm text-destructive">{loadError}</p>}
            {candidate && (
              <>
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    Needs review
                    {candidate.latestVisitNumber ? ` · Visit ${candidate.latestVisitNumber}` : ''}
                    {candidate.latestVisitDate ? ` · ${formatDate(candidate.latestVisitDate)}` : ''}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-foreground">{candidate.name}</h2>
                </div>
                {candidate.suggestion && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    The system suggests <LevelChip level={candidate.suggestion.level} />
                    {conf && <span>· {conf}</span>}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-foreground">Findings</p>
                  {findings.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                      {findings.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Nothing charted on this visit.</p>
                  )}
                </div>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Not counted in reports until the dentist reviews it.</p>
                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                  <button type="button" onClick={() => setReviewing(true)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                    Review now
                  </button>
                  <button type="button" onClick={() => navigate(`/ai-analytics?student=${encodeURIComponent(studentId)}`)}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted">
                    Open in Risk Classification
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {reviewing && candidate && (
        <RiskReviewDialog
          candidate={candidate}
          canSave={canSave}
          serviceDown={false}
          onClose={() => { setReviewing(false); close(); }}
          onSaved={() => { setReviewing(false); close(); onSaved(); }}
        />
      )}
    </>
  );
}
