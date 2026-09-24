import { useEffect, useRef, useState } from 'react';
import { computeBmi, BMI_NOTE, classifyNutritionalStatus } from '../utils/bmi';
import type { MedicalHistoryDraft, MedFlag, MedText, DietDraft, MeasureDraft } from './iptrDrafts';

// The History tab — physical measurements, medical history, dietary/social
// history.
//
// Extracted from `DentalChart.tsx` in Sprint 162c, unchanged.
//
// ⚠ ORAL HEALTH CONDITION IS DELIBERATELY NOT HERE (Sprint 176, hers). It is
// the same ORAL_HEALTH_CONDITION record the Oral Conditions card on the Dental
// Chart tab edits — two editors for one record, on adjacent tabs, is how a
// screen ends up disagreeing with itself. It lives beside the odontogram now,
// because that is where a clinician is looking when they notice calculus.

// Height is typed in any of three units but STORED in cm only (height_cm) —
// BMI, the DOH forms and the DB never see anything else. Feet + inches is the
// default: it is what the clinic reads first, and the tab returns to it every
// time the record leaves edit mode (saved or cancelled).
type HeightUnit = 'ftin' | 'cm' | 'm';
type HeightDraft = { main: string; inches: string };
const roundStr = (n: number, d: number) => String(Math.round(n * 10 ** d) / 10 ** d);

function cmToHeightDraft(cmStr: string, unit: HeightUnit): HeightDraft {
  const cm = Number(cmStr);
  if (cmStr === '' || !Number.isFinite(cm) || cm <= 0) return { main: '', inches: '' };
  if (unit === 'cm') return { main: cmStr, inches: '' };
  if (unit === 'm') return { main: roundStr(cm / 100, 3), inches: '' };
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inches = Math.round((totalIn - ft * 12) * 10) / 10;
  if (inches >= 12) { ft += 1; inches = 0; }
  return { main: String(ft), inches: String(inches) };
}

function heightDraftToCm(d: HeightDraft, unit: HeightUnit): string {
  if (unit === 'cm') return d.main;
  if (unit === 'm') return d.main === '' ? '' : roundStr(Number(d.main) * 100, 1);
  if (d.main === '' && d.inches === '') return '';
  return roundStr((Number(d.main || 0) * 12 + Number(d.inches || 0)) * 2.54, 1);
}

// DOH Form 1 history questions with no IPTR chip of their own (2026-09-24),
// verbatim from the printed form. Numbers match the form.
const FORM1_QUESTIONS: { n: number; q: string; field: MedFlag; femaleOnly?: boolean }[] = [
  { n: 3, q: 'Mayroon ka bang sakit sa atay?', field: 'liver_disease' },
  { n: 4, q: 'Ikaw ba ay kulang sa dugo?', field: 'anemia' },
  { n: 7, q: 'Mayroon ka bang allergy sa pamamanhid (anesthesia)?', field: 'anesthesia_allergy' },
  { n: 8, q: 'Ikaw ba ay nabunutan na ng ngipin?', field: 'previous_extraction' },
  { n: 9, q: 'Ikaw ba ay madugo kapag binubunutan ng ngipin?', field: 'extraction_bleeding' },
  { n: 10, q: 'Naninikip ba ang iyong dibdib? / meadaling mapagod?', field: 'chest_tightness' },
  { n: 11, q: 'Mayroon ka bang hika?', field: 'asthma' },
  { n: 12, q: 'Mayroon ka bang regla? (para sa babae)', field: 'menstruation', femaleOnly: true },
  { n: 13, q: 'Ikaw ba ay buntis?', field: 'pregnant', femaleOnly: true },
  { n: 15, q: 'Ikaw ba ay may iniinom na gamot sa kasalukuyan?', field: 'current_medication' },
  { n: 16, q: 'Ikaw ba ay may epilepsy?', field: 'epilepsy' },
];

/** The tick-box chip used across this tab. Ticked prints "Oo" on DOH Form 1,
 *  unticked prints "Hindi". */
function CheckChip({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${checked ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-foreground'} ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-canvas'}`}>
      <input type="checkbox" disabled={disabled} checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 shrink-0 rounded accent-primary disabled:cursor-not-allowed" />
      {label}
    </label>
  );
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
}) {
  // Form 1 Q12 (regla) and Q13 (buntis) are for girls only.
  const isFemale = sex === 'Female';
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('ftin');
  const [heightDraft, setHeightDraft] = useState<HeightDraft>(() => cmToHeightDraft(measure.height_cm, 'ftin'));
  // What the draft was last derived from — so a reload / cancel / year switch
  // re-derives it, but the user's own keystrokes are never reformatted mid-type.
  const heightSynced = useRef({ cm: measure.height_cm, unit: heightUnit });
  useEffect(() => { if (!editing) setHeightUnit('ftin'); }, [editing]);
  useEffect(() => {
    if (heightSynced.current.cm === measure.height_cm && heightSynced.current.unit === heightUnit) return;
    heightSynced.current = { cm: measure.height_cm, unit: heightUnit };
    setHeightDraft(cmToHeightDraft(measure.height_cm, heightUnit));
  }, [measure.height_cm, heightUnit]);
  const updateHeight = (next: HeightDraft) => {
    setHeightDraft(next);
    const cm = heightDraftToCm(next, heightUnit);
    heightSynced.current = { cm, unit: heightUnit };
    setMeasure((p) => ({ ...p, height_cm: cm }));
  };
  const noSpin = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const heightInput = `min-w-0 flex-1 text-sm border border-border rounded px-2 py-1.5 ${noSpin} focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed`;

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
      <div className="bg-card rounded-xl border border-border p-3">
        <div className="text-base font-bold text-foreground mb-2">Physical Measurements</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">Height</label>
            <div className="flex gap-1">
              {heightUnit === 'ftin' ? (
                <>
                  <input type="number" min="0" max="9" step="1" inputMode="numeric" disabled={!editing} aria-label="Height, feet"
                    value={heightDraft.main}
                    onChange={(e) => updateHeight({ ...heightDraft, main: e.target.value })}
                    placeholder="ft" className={heightInput} />
                  <input type="number" min="0" max="11.9" step="0.1" inputMode="decimal" disabled={!editing} aria-label="Height, inches"
                    value={heightDraft.inches}
                    onChange={(e) => updateHeight({ ...heightDraft, inches: e.target.value })}
                    placeholder="in" className={heightInput} />
                </>
              ) : (
                <input type="number" min="0" max={heightUnit === 'm' ? '3' : '300'} step={heightUnit === 'm' ? '0.01' : '0.1'} inputMode="decimal" disabled={!editing}
                  aria-label={heightUnit === 'm' ? 'Height, meters' : 'Height, centimeters'}
                  value={heightDraft.main}
                  onChange={(e) => updateHeight({ main: e.target.value, inches: '' })}
                  placeholder={heightUnit === 'm' ? 'e.g. 1.20' : 'e.g. 120'} className={heightInput} />
              )}
              {/* Display unit only — switching never rewrites the stored cm. */}
              <select value={heightUnit} onChange={(e) => setHeightUnit(e.target.value as HeightUnit)} aria-label="Height unit"
                className="shrink-0 text-sm border border-border rounded bg-card px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="ftin">ft/in</option>
                <option value="cm">cm</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">Weight (kg)</label>
            <input type="number" min="0" max="500" step="0.1" inputMode="decimal" disabled={!editing}
              value={measure.weight_kg}
              onChange={(e) => setMeasure((p) => ({ ...p, weight_kg: e.target.value }))}
              placeholder="e.g. 25" className="w-full text-sm border border-border rounded px-2 py-1.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">Temperature (°C)</label>
            <input type="number" min="0" max="45" step="0.1" inputMode="decimal" disabled={!editing}
              value={measure.temperature_c}
              onChange={(e) => setMeasure((p) => ({ ...p, temperature_c: e.target.value }))}
              placeholder="e.g. 36.5" className="w-full text-sm border border-border rounded px-2 py-1.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5">Blood Pressure</label>
            {/* Text, not two numbers: read and written as one pair, and
                nothing here queries systolic alone. */}
            <input type="text" disabled={!editing}
              value={measure.blood_pressure}
              onChange={(e) => setMeasure((p) => ({ ...p, blood_pressure: e.target.value }))}
              placeholder="e.g. 110/70" className="w-full text-sm border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
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
                  <label className="block text-xs text-muted-foreground mb-0.5">BMI</label>
                  <div className="w-full text-sm border border-border rounded px-2 py-1.5 bg-muted text-muted-foreground" title={BMI_NOTE}>
                    {bmiValue ?? 'Automatic'}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs text-muted-foreground mb-0.5">Nutritional Status</label>
                  <div className={`w-full text-sm border border-border rounded px-2 py-1.5 ${statusColor}`}
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
              its label at any width.
              On DOH Form 1 a ticked chip prints under Oo, an unticked one
              under Hindi (user, 2026-09-24). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['Hypertension / CVA', 'hypertension'], ['Diabetes Mellitus', 'diabetes_mellitus'],
              ['Blood Disorders', 'blood_disorders'], ['Cardiovascular / Heart Diseases', 'cardiovascular_disease'],
              ['Thyroid Disorders', 'thyroid_disorders'], ['Hepatitis', 'hepatitis_disorders'], ['Malignancy', 'malignancy'],
              ['History of Hospitalization', 'previous_hospitalization'], ['Surgical (Post-Operative)', 'previous_surgical'],
              ['Blood Transfusion', 'blood_transfusion'], ['Tattoo', 'tattoo'],
            ] as [string, MedFlag][]).map(([label, field]) => (
              <CheckChip key={field} label={label} checked={med[field]} disabled={!editing}
                onChange={(v) => setMed((p) => ({ ...p, [field]: v }))} />
            ))}
          </div>
          {/* The forms' "Please specify" details. A detail box appears once its
              condition is answered Oo, and stays while it holds text, so an
              un-ticked condition never hides something already written. */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['Allergies (please specify)', 'allergies', null, 'e.g. penicillin, shrimp'],
              ['Hepatitis (please specify type)', 'hepatitis_type', 'hepatitis_disorders', 'e.g. Hepatitis B'],
              ['Malignancy (please specify)', 'malignancy_details', 'malignancy', ''],
              ['Blood transfusion (month & year)', 'blood_transfusion_date', 'blood_transfusion', 'e.g. March 2024'],
              ['Last admission & cause', 'last_admission', 'previous_hospitalization', 'e.g. June 2025, dengue'],
              ['Others (please specify)', 'others', null, ''],
            ] as [string, MedText, MedFlag | null, string][])
              .filter(([, field, flag]) => !flag || med[flag] === true || med[field] !== '')
              .map(([label, field, , placeholder]) => (
                <div key={field}>
                  <label className="block text-xs text-muted-foreground mb-1">{label}</label>
                  <input type="text" disabled={!editing} value={med[field]} placeholder={placeholder}
                    onChange={(e) => setMed((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full text-xs border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
                </div>
              ))}
          </div>

          {/* DOH Form 1's Filipino questions that the chips above do not
              answer, verbatim from the form (its own spelling). Ticked prints
              under Oo, unticked under Hindi. Q12 and Q13 are for girls only. */}
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-sm font-bold text-foreground">Form 1 Questions</div>
            <p className="text-[11px] text-muted-foreground mb-2">
              Questions 1, 2, 5, 6 and 14 are answered by the chips above.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FORM1_QUESTIONS.filter((q) => !q.femaleOnly || isFemale).map((q) => (
                <CheckChip key={q.field} label={`${q.n}. ${q.q}`} checked={med[q.field]} disabled={!editing}
                  onChange={(v) => setMed((p) => ({ ...p, [q.field]: v }))} />
              ))}
            </div>
            {(med.current_medication === true || med.medication_details !== '') && (
              <div className="mt-2">
                <label className="block text-xs text-muted-foreground mb-1">15. Anong gamot? (medicine taken)</label>
                <input type="text" disabled={!editing} value={med.medication_details}
                  onChange={(e) => setMed((p) => ({ ...p, medication_details: e.target.value }))}
                  className="w-full text-xs border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed" />
              </div>
            )}
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

    </div>
  );
}
