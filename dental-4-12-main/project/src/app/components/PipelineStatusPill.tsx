import type { StudentRow } from '../hooks/useStudents';

// Filled-pill badge for a pupil's treatment-pipeline stage this school year
// (user, 2026-09-28, chose "Option A -- matches GradePill's own style" from
// the design review). Colors read as a rough traffic-light: gray = not
// started, amber/blue = in progress, green = done.
const META: Record<StudentRow['pipelineStatus'], { bg: string; fg: string }> = {
  'For Oral Exam': { bg: '#F1F5F9', fg: '#475569' },
  'For First Treatment': { bg: '#FEF3C7', fg: '#B45309' },
  'For Second Treatment': { bg: '#DBEAFE', fg: '#1D4ED8' },
  Completed: { bg: '#DCFCE7', fg: '#15803D' },
};

// Display text only (user, 2026-09-28: "For Visit 1"/"For Visit 2" read
// clearer than "For First/Second Treatment") -- the underlying
// StudentRow['pipelineStatus'] values are unchanged, since filtering
// (TreatmentRecords.tsx's pipelineFilter) and the server both match against
// the original strings.
const LABEL: Record<StudentRow['pipelineStatus'], string> = {
  'For Oral Exam': 'For Oral Exam',
  'For First Treatment': 'For Visit 1',
  'For Second Treatment': 'For Visit 2',
  Completed: 'Completed',
};

export const PipelineStatusPill = ({
  status,
  isRpcDueThisMonth = false,
}: {
  status: StudentRow['pipelineStatus'];
  /** Whether THIS pupil's RPC Visit 2 falls due within the current calendar
   *  month -- the same 'due_this_month' rule Treatment Queue's auto-enqueue
   *  and RPC Monitoring's own sort/filter both use. Every "For Second
   *  Treatment" row IS structurally a pending RPC Visit 2, but the chip
   *  should only call out the ones that need attention NOW (user,
   *  2026-09-28: "the RPC should only show if they are due this month") --
   *  not every pupil who merely hasn't had Visit 2 yet, which could be
   *  months away. Callers pass this from their own useRPCTracking({ sort:
   *  'due_this_month' }) result; omitted entirely, the chip stays hidden. */
  isRpcDueThisMonth?: boolean;
}) => {
  const meta = META[status];
  return (
    <span
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
    >
      {LABEL[status]}
      {status === 'For Second Treatment' && isRpcDueThisMonth && (
        <span style={{ backgroundColor: meta.fg }} className="ml-1.5 rounded-full px-1.5 py-px text-[8px] font-extrabold tracking-wide text-white">
          RPC
        </span>
      )}
    </span>
  );
};
