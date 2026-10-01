import { Link } from 'react-router';
import { Brain } from 'lucide-react';

// The AI Risk tab — a signpost, not a workflow.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged. The full
// assessment workflow (generate, validate, save) lives on the dedicated Risk
// Classification page since Sprint 21f; this tab points there rather than
// duplicating that UI.
//
// It takes NO PROPS — no state, no handlers, nothing from the chart. That is
// why it went first of the six remaining panels: the move cannot change
// behaviour because there is no behaviour to change.
//
// ⚠ The synthetic-data sentence is deliberate and must not be softened. CLAUDE.md
// requires that the model's training data be stated honestly on screen until
// real IPTR records replace it.

export function AiRiskTab() {
  return (
    <div className="p-4">
      <div className="text-center py-12 text-muted-foreground">
        <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium text-muted-foreground">Risk assessments live on the Risk Classification page</p>
        <p className="text-xs mt-1 max-w-sm mx-auto">Generate, validate, and save AI-assisted risk assessments for this student from the dedicated page. The current model is trained on synthetic placeholder data until real IPTR records are available.</p>
        <Link to="/ai-analytics" className="inline-block mt-4 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg">Open Risk Classification</Link>
      </div>
    </div>
  );
}
