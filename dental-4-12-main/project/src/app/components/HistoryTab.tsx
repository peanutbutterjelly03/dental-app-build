import { Link } from 'react-router';
import { Shield } from 'lucide-react';
import { computeBmi, BMI_NOTE, classifyNutritionalStatus } from '../utils/bmi';
import type { MedicalHistoryDraft, DietDraft, MeasureDraft } from './iptrDrafts';

// The History tab — physical measurements, medical history, dietary/social
// history, the RA 10173 notice and this pupil's upcoming appointments.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged.
//
// ⚠ ORAL HEALTH CONDITION IS DELIBERATELY NOT HERE (Sprint 176, hers). It is
// the same ORAL_HEALTH_CONDITION record the Oral Conditions card on the Dental
// Chart tab edits — two editors for one record, on adjacent tabs, is how a
// screen ends up disagreeing with itself. It lives beside the odontogram now,
// because that is where a clinician is looking when they notice calculus.

export interface StudentAppointmentRow {
  id: string;
  type: string;
  date: string;
  time: string;
  status: string;
}

export function HistoryTab({
  editing,
  measure,
  setMeasure,
  med,
  setMed,
  diet,
  setDiet,
  patientAgeMonths,
  sex,
  appointments,
}: {
  /** Every field on this tab is disabled unless the record is in edit mode —
   *  the tab is a reader by default and an editor only on request. */
  editing: boolean;
  measure: MeasureDraft;
  setMeasure: React.Dispatch<React.SetStateAction<MeasureDraft>>;
  med: MedicalHistoryDraft;
  setMed: React.Dispatch<React.SetStateAction<MedicalHistoryDraft>>;
  diet: DietDraft;
  setDiet: React.Dispatch<React.SetStateAction<DietDraft>>;
  /** Needed for BMI-for-Age, which is keyed on exact age in months and sex. */
  patientAgeMonths: number | null;
  sex: string;
  appointments: StudentAppointmentRow[];
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Physical Measurements — first on the tab, hers (Sprint 173).
          These were three grey read-only rows on the patient card, typed
          somewhere else entirely (the Edit Student Info panel). Two
          places for one record is how a screen ends up disagreeing with
          itself, so both of those are gone and this is the one editor. */}
      {/* ⚠ A CARD, like every other section on this tab. An earlier pass
          stripped it on the reasoning that the tab body is already a card
          — true, but its siblings are all nested cards inside it, so this
          was the one section sitting bare. */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="text-base font-bold text-foreground mb-3">Physical Measurements</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Height (cm)</label>
            <input type="number" min="0" max="300" step="0.1" inputMode="decimal" disabled={!editing}
              value={measure.height_cm}
              onChange={(e) => setMeasure((p) => ({ ...p, height_cm: e.target.value }))}
              placeholder="e.g. 120" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Weight (kg)</label>
            <input type="number" min="0" max="500" step="0.1" inputMode="decimal" disabled={!editing}
              value={measure.weight_kg}
              onChange={(e) => setMeasure((p) => ({ ...p, weight_kg: e.target.value }))}
              placeholder="e.g. 25" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Temperature (°C)</label>
            <input type="number" min="0" max="45" step="0.1" inputMode="decimal" disabled={!editing}
              value={measure.temperature_c}
              onChange={(e) => setMeasure((p) => ({ ...p, temperature_c: e.target.value }))}
              placeholder="e.g. 36.5" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Blood Pressure</label>
            {/* Text, not two numbers: read and written as one pair, and
                nothing here queries systolic alone. */}
            <input type="text" disabled={!editing}
              value={measure.blood_pressure}
              onChange={(e) => setMeasure((p) => ({ ...p, blood_pressure: e.target.value }))}
              placeholder="e.g. 110/70" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          {(() => {
            const bmiValue = computeBmi(Number(measure.height_cm) || null, Number(measure.weight_kg) || null);
            const status = classifyNutritionalStatus(bmiValue, patientAgeMonths, sex);
            const statusColor =
              status === 'Normal' ? 'bg-success-surface text-success'
              : status === 'Overweight' || status === 'Obese' ? 'bg-warning-surface text-warning'
              : status === 'Wasted' || status === 'Severely Wasted' ? 'bg-danger-surface text-destructive'
              : 'bg-muted text-muted-foreground';
            // ⚠ Say WHY it is blank. "Nothing measured yet" and "no
            // reference exists for this age" look identical as a dash,
            // and only one of them is the user's to fix.
            const statusFallback = bmiValue == null
              ? 'Automatic'
              : (patientAgeMonths ?? 0) < 72
              ? 'No reference below age 6'
              : 'No reference above age 19';
            return (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">BMI</label>
                  <div className="w-full text-xs border border-border rounded px-2 py-1 bg-muted text-muted-foreground" title={BMI_NOTE}>
                    {bmiValue ?? 'Automatic'}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-muted-foreground mb-1">Nutritional Status</label>
                  <div className={`w-full text-xs border border-border rounded px-2 py-1 ${statusColor}`}
                    title="DOH/DepEd BMI-for-Age classification, 6-19 years old — blank outside that range.">
                    {status ?? statusFallback}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          {/* Her heading: sentence case at text-base with the instruction
              under it, not a small uppercase label. */}
          <div className="text-base font-bold text-foreground">Medical History</div>
          <p className="text-xs text-muted-foreground mb-3">Select all applicable conditions.</p>
          {/* ⚠ Sprint 165 — chips, not label-left/checkbox-right rows.
              Removing the record page's width cap stretched those rows to
              the full content width and left every checkbox a hand-span
              from the word it belonged to. Her chips keep the box against
              its label at any width. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['Hypertension / CVA', 'hypertension'], ['Diabetes Mellitus', 'diabetes'],
              ['Cardiovascular / Heart Diseases', 'cardiovascular'], ['Thyroid Disorders', 'thyroid'],
              ['Hepatitis', 'hepatitis'], ['Malignancy', 'malignancy'],
              ['History of Hospitalization', 'hospitalization'], ['Blood Transfusion', 'bloodTransfusion'], ['Tattoo', 'tattoo'],
            ] as [string, keyof MedicalHistoryDraft][]).map(([label, field]) => (
              <label key={field} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${!!med[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-foreground'} ${editing ? 'cursor-pointer hover:bg-canvas' : 'cursor-not-allowed opacity-70'}`}>
                <input type="checkbox" disabled={!editing} checked={!!med[field]}
                  onChange={(e) => setMed((p) => ({ ...p, [field]: e.target.checked }))}
                  className="w-4 h-4 rounded accent-primary disabled:cursor-not-allowed" />
                {label}
              </label>
            ))}
            <div className="pt-1">
              <label className="block text-xs text-muted-foreground mb-1">Allergies</label>
              <input type="text" disabled={!editing} value={med.allergies} onChange={(e) => setMed((p) => ({ ...p, allergies: e.target.value }))}
                placeholder="—" className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-base font-bold text-foreground">Dietary Habits and Social History</div>
          <p className="text-xs text-muted-foreground mb-3">Select all applicable conditions.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['Sugar Sweetened Beverages/Food', 'sugarSweetened'], ['Alcohol Drinker', 'alcoholDrinker'],
              ['Tobacco User', 'tobaccoUser'], ['Betel Nut Chewer', 'betelNut'],
              ['Body Piercing', 'bodyPiercing'], ['Nail Biting', 'nailBiting'], ['Thumbsucking', 'thumbsucking'],
            ] as [string, keyof DietDraft][]).map(([label, field]) => (
              <label key={field} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${!!diet[field] ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-foreground'} ${editing ? 'cursor-pointer hover:bg-canvas' : 'cursor-not-allowed opacity-70'}`}>
                <input type="checkbox" disabled={!editing} checked={!!diet[field]}
                  onChange={(e) => setDiet((p) => ({ ...p, [field]: e.target.checked }))}
                  className="w-4 h-4 rounded accent-primary disabled:cursor-not-allowed" />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ⚠ Both kept from the Consent tab deleted in Sprint 171, because
          neither has another home. The RA 10173 notice appears NOWHERE
          else — not even on the printed consent form — and deleting a
          legal notice to match a tab count is not a design decision.
          Upcoming Appointments is real data read from this pupil's schedule.

          NOT kept: the on-screen signature rules. Consent is signed on
          the printed form (Reports → Consent Form), which carries the
          real PANGALAN NG MAGULANG/GUARDIAN block; ruled lines on a
          screen were never signable. */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-blue-900 mb-1">Republic Act No. 10173 — Data Privacy Act of 2012</div>
            <p className="text-xs text-blue-700 leading-relaxed">
              Ang impormasyong nakolekta sa form na ito ay gagamitin lamang para sa mga layuning pangkalusugan ng Dental Health Program ng Barangay Tanyag, Lungsod ng Taguig. Ang inyong personal na impormasyon ay protektado ng Batas Republika Blg. 10173 o ang Data Privacy Act ng 2012. Ang inyong datos ay hindi ibabahagi sa anumang partido na walang pahintulot maliban kung kinakailangan ng batas.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-foreground">Upcoming Appointments</div>
          <Link to="/appointments" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        {appointments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No upcoming appointments scheduled.</p>
        ) : (
          <div className="space-y-2">
            {appointments.map((apt) => (
              <div key={apt.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <div className="text-xs font-medium text-foreground">{apt.type}</div>
                  <div className="text-xs text-muted-foreground">{apt.date} at {apt.time}</div>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{apt.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
