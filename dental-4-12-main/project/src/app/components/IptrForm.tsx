import type { ApiStudent, ApiDentist } from '../api/types';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import type { IptrYearData } from '../hooks/useDentalChartData';
import { formatDate } from '../utils/localDate';
import { surnameFirst } from '../utils/studentName';
import {
  upperPermanent,
  lowerPermanent,
  upperTemporary,
  lowerTemporary,
  conditionCodes,
} from '../utils/dentalChartCodes';

// ─── INDIVIDUAL PATIENT TREATMENT RECORD — page 1 (Sprint 135) ──────────────
//
// Built to the official form, read from the manuscript's own scan
// (`docs/Group404 - Manuscript.md`, Appendix G, `image19` — 576x740 and
// legible). Page 2, the five per-year dental charts, is a separate sprint.
//
// ⚠ WHY THIS EXISTS AT ALL: the "IPTR PDF" was a screen capture of
// `DentalChart`'s record region — the patient-info card, the tab strip, the
// Edit buttons, whatever tab was open. That is the document a family or a
// referral is handed. CLAUDE.md: a printout IS the form, reproduced page by
// page, in the form's own wording and order.
//
// ⚠ EVERY ROW OF THE PAPER FORM IS RENDERED, including the ones this system
// has no source for. A blank cell on a DOH form is meaningful; a MISSING row
// makes it a different form. The rows with no source are named in
// NO_SOURCE_NOTE below rather than being quietly dropped.

/** The form's own Year 1 … Year 5 columns. A school year's IPTR fills one. */
const YEAR_COLUMNS = 5;

const tick = (v: boolean | undefined | null) => (v === true ? '✓' : '');

type Row = {
  label: string;
  indent?: boolean;
  /** Value for one school year, or null where the form has no source here. */
  value: ((y: IptrYearData) => string) | null;
};

const MEDICAL_ROWS: Row[] = [
  { label: 'Allergies (Please specify)', value: (y) => y.medicalHistory?.allergies ?? '' },
  { label: 'Hypertension / CVA', value: (y) => tick(y.medicalHistory?.hypertension) },
  { label: 'Diabetes Mellitus', value: (y) => tick(y.medicalHistory?.diabetes_mellitus) },
  // No source: MEDICAL_HISTORY has no blood-disorder field. Printed blank.
  { label: 'Blood Disorders', value: null },
  { label: 'Cardiovascular / Heart Diseases', value: (y) => tick(y.medicalHistory?.cardiovascular_disease) },
  { label: 'Thyroid Disorders', value: (y) => tick(y.medicalHistory?.thyroid_disorders) },
  { label: 'Hepatitis (Please specify type)', value: (y) => tick(y.medicalHistory?.hepatitis_disorders) },
  { label: 'Malignancy (Please specify)', value: (y) => tick(y.medicalHistory?.malignancy) },
  { label: 'History of Previous Hospitalization', value: (y) => tick(y.medicalHistory?.previous_hospitalization) },
  // Sub-rows of the hospitalisation row on the paper form.
  { label: 'Medical (Last Admission & Cause)', indent: true, value: null },
  { label: 'Surgical (Post-Operative)', indent: true, value: (y) => tick(y.medicalHistory?.previous_surgical) },
  { label: 'Blood transfusion (Month & Year)', value: (y) => tick(y.medicalHistory?.blood_transfusion) },
  { label: 'Tattoo', value: (y) => tick(y.medicalHistory?.tattoo) },
  { label: 'Others (Please specify)', value: (y) => y.medicalHistory?.others ?? '' },
];

const DIETARY_ROWS: Row[] = [
  { label: 'Sugar Sweetened Beverages / Food Drinker / Eater', value: (y) => tick(y.dietaryHabits?.sugar_beverages) },
  { label: 'Alcohol Drinker', value: (y) => tick(y.dietaryHabits?.alcohol_drinker) },
  { label: 'Tobacco User', value: (y) => tick(y.dietaryHabits?.tobacco_user) },
  { label: 'Betel Nut Chewer', value: (y) => tick(y.dietaryHabits?.betel_nut_chewer) },
  { label: 'Body Piercing', value: (y) => tick(y.dietaryHabits?.body_piercing) },
  { label: 'Nail Biting', value: (y) => tick(y.dietaryHabits?.nail_biting) },
  { label: 'Thumbsucking', value: (y) => tick(y.dietaryHabits?.thumb_sucking) },
];

/** Decayed teeth in either dentition, from that year's tooth records.
 *  ⚠ DERIVED, not fabricated: ORAL_HEALTH_CONDITION has no `dental_caries`
 *  boolean, and the tooth records are the same source the Target Client List
 *  already uses for its caries columns. Reading `condition`, never
 *  `treatment_code` — X means "indicated for extraction" as a condition and
 *  "extracted" as a treatment. */
const hasCaries = (y: IptrYearData) =>
  y.toothRecords.some((t) => t.condition === 'D' || t.condition === 'd');

const ORAL_ROWS: Row[] = [
  // No source: "Orally Fit" is a clinical judgement the model does not store —
  // RISK_STRATIFICATION's OFC is about risk, not this checkbox.
  { label: 'Orally Fit', value: null },
  { label: 'Dental Caries', value: (y) => (hasCaries(y) ? '✓' : '') },
  { label: 'Gingivitis', value: (y) => tick(y.oralCondition?.gingivitis) },
  { label: 'Periodontal Diseases', value: (y) => tick(y.oralCondition?.periodontal_disease) },
  { label: 'Debris', value: (y) => tick(y.oralCondition?.debris) },
  { label: 'Calculus', value: (y) => tick(y.oralCondition?.calculus) },
  { label: 'Abnormal Growth', value: (y) => tick(y.oralCondition?.abnormal_growth) },
  { label: 'Cleft Lip / Palate', value: (y) => tick(y.oralCondition?.cleft_lip_palate) },
  // No source: no field records a fully edentulous pupil.
  { label: 'Completely Edentulous', value: null },
  { label: 'Others (Please specify)', value: (y) => y.oralCondition?.others ?? '' },
];

/** The consent paragraph is part of the printed form and is reproduced
 *  verbatim from the scan — it is what the guardian signs under. */
const CONSENT_TEXT =
  'Pinahihintulutan ko ang Dentista na gawin ang mga kinakailangang Dental Procedure/Treatment sa aking ngipin at bibig o ngipin ng aking anak/kapatid/apo/pamangkin ' +
  'gaya ng ipinaliwanag sa akin. Naiintindihan ko na ang ngipin na maaring magkaroon depende sa hindi matiyak na mga pangyayari habang ginagamot. Ang lahat ng ' +
  'procedure ay maayos na ipinaliwanag sa akin, at anumang hindi kanais-nais na mga pangyayari habang o pagkatapos ng gamutan ay aking pananagutan.';

const NO_SOURCE_NOTE =
  'Blood Disorders · Medical (Last Admission & Cause) · Orally Fit · Completely Edentulous · Occupation · Temp · BP · ' +
  'Chief Complaint · Signature — these are on the paper form and the system records no value for them, so they print blank.';

interface Props {
  student: ApiStudent;
  /** Newest last, as `useDentalChartData` returns them. */
  years: IptrYearData[];
  dentists: ApiDentist[];
}

export function IptrForm({ student, years, dentists }: Props) {
  // → The DOH IPTR is a portrait sheet; this renders at a fixed 780px, which is A4 portrait's width.
  usePrintOrientation('portrait');
  const dentistNameById = new Map(dentists.map((d) => [d._id, `Dr. ${d.first_name} ${d.last_name}`]));

  // The form has five year columns. More than five school years is a real
  // possibility for a pupil followed K-G10, so the LAST five are shown — the
  // form cannot hold more, and silently showing the oldest would hide current
  // care. Fewer than five leaves the remaining columns blank, as on paper.
  const shown = years.slice(-YEAR_COLUMNS);
  const cols = Array.from({ length: YEAR_COLUMNS }, (_, i) => shown[i] ?? null);

  const age = (() => {
    if (!student.birthday) return '';
    const b = new Date(student.birthday);
    if (Number.isNaN(b.getTime())) return '';
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return String(a);
  })();

  const visits = years
    .flatMap((y) => y.treatments.map((t) => ({ t, weight: y.iptr.weight_kg })))
    .sort((a, b) => a.t.date.localeCompare(b.t.date));

  const th = 'border border-black px-1 py-0.5 text-[9px] font-semibold text-center';
  const td = 'border border-black px-1 py-0.5 text-[9px] align-top';
  const label = 'border border-black px-1 py-0.5 text-[9px]';

  const section = (title: string) => (
    <tr>
      <td className={`${label} font-bold bg-gray-100`} colSpan={YEAR_COLUMNS + 1}>{title}</td>
    </tr>
  );

  const renderRows = (rows: Row[]) =>
    rows.map((r) => (
      <tr key={r.label}>
        <td className={`${label} ${r.indent ? 'pl-4' : ''}`}>{r.label}</td>
        {cols.map((y, i) => (
          <td key={i} className={`${td} text-center`}>{y && r.value ? r.value(y) : ''}</td>
        ))}
      </tr>
    ));

  return (
    <div className="form-print bg-white text-black mx-auto p-6" style={{ width: 780 }}>
      <div className="text-center leading-tight">
        <div className="text-[10px]">REPUBLIC OF THE PHILIPPINES</div>
        <div className="text-[11px] font-bold">DEPARTMENT OF HEALTH</div>
        <div className="text-[10px]">City of Taguig</div>
        <div className="text-[9px] italic">(Municipality/City/Province)</div>
        <div className="mt-2 text-[13px] font-bold tracking-wide">INDIVIDUAL PATIENT TREATMENT RECORD</div>
      </div>

      <div className="mt-3 text-[10px]">
        <div className="font-semibold">Personal Information</div>
        <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1">
          <div>Patient&apos;s Name: <span className="border-b border-black inline-block min-w-[180px]">{surnameFirst(student)}</span></div>
          <div>
            Birthday: <span className="border-b border-black inline-block min-w-[90px]">{student.birthday ? formatDate(student.birthday) : ''}</span>
            {' '}Age: <span className="border-b border-black inline-block min-w-[30px]">{age}</span>
            {' '}Sex: <span className="border-b border-black inline-block min-w-[50px]">{student.sex ?? ''}</span>
          </div>
          <div>Address: <span className="border-b border-black inline-block min-w-[200px]">{student.address ?? ''}</span></div>
          {/* No model stores Occupation — printed blank, never omitted. */}
          <div>
            Occupation: <span className="border-b border-black inline-block min-w-[80px]" />
            {' '}Contact #: <span className="border-b border-black inline-block min-w-[90px]">{student.contact_number ?? ''}</span>
          </div>
          <div>Philhealth ID Principal / Dependent: <span className="border-b border-black inline-block min-w-[120px]">{student.philhealth_number ?? ''}</span></div>
          <div>4Ps / NHTS: <span className="border-b border-black inline-block min-w-[120px]">{student.fourps_id ?? ''}</span></div>
        </div>
      </div>

      <div className="mt-2 text-[9px] italic">
        Lagyan ng ✓ kung ikaw ay NAKARANAS o NAKARARANAS ng mga sumusunod:
      </div>

      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            <th className={`${th} text-left w-[38%]`} />
            {cols.map((_, i) => <th key={i} className={th}>Year {i + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${label} font-bold`}>DATE EXAMINED</td>
            {cols.map((y, i) => (
              <td key={i} className={`${td} text-center`}>{y ? y.iptr.school_year : ''}</td>
            ))}
          </tr>
          {section('Medical History')}
          {renderRows(MEDICAL_ROWS)}
          {section('Dietary Habits and Social History')}
          {renderRows(DIETARY_ROWS)}
          {section('Oral Health Condition')}
          {renderRows(ORAL_ROWS)}
        </tbody>
      </table>

      <p className="mt-3 text-[8px] leading-snug text-justify">{CONSENT_TEXT}</p>

      <div className="mt-6 grid grid-cols-2 gap-8 text-center text-[9px]">
        <div><div className="border-t border-black pt-0.5">Lagda ng Pasyente</div></div>
        <div><div className="border-t border-black pt-0.5">Lagda ng Magulang o Guardian</div></div>
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr>
            {['Date', 'Weight', 'Temp', 'BP', 'Chief Complaint', 'Diagnosis', 'Treatment Done', 'Dentist', 'Signature', 'Remarks']
              .map((h) => <th key={h} className={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {visits.map(({ t, weight }) => (
            <tr key={t._id}>
              <td className={td}>{formatDate(t.date)}</td>
              <td className={`${td} text-center`}>{weight ?? ''}</td>
              {/* Temp, BP, Chief Complaint and Signature are on the form and
                  have no source in this system — blank, not omitted. */}
              <td className={td} />
              <td className={td} />
              <td className={td} />
              <td className={td}>{t.diagnosis}</td>
              <td className={td}>{t.treatment_done}</td>
              <td className={td}>{dentistNameById.get(t.dentist_id) ?? ''}</td>
              <td className={td} />
              <td className={td}>{t.remarks}</td>
            </tr>
          ))}
          {/* The paper form carries ruled blank lines to write on. Keep enough
              that a printed copy is usable at the chairside. */}
          {Array.from({ length: Math.max(0, 8 - visits.length) }).map((_, i) => (
            <tr key={`blank-${i}`}>
              {Array.from({ length: 10 }).map((__, j) => <td key={j} className={`${td} h-4`} />)}
            </tr>
          ))}
        </tbody>
      </table>

      {/* On screen this explains the blanks; it must never reach paper. */}
      <p className="print-hide mt-2 text-[10px] leading-relaxed text-muted-foreground">{NO_SOURCE_NOTE}</p>
    </div>
  );
}

// ─── INDIVIDUAL PATIENT TREATMENT RECORD — page 2 (Sprint 136) ──────────────
//
// Built to Appendix G's second scan (`image20`): the heading "Dental Charting",
// FIVE tooth charts (one per year, each with its own Date), the two printed
// legends, and "Signature of Examining Dentist".
//
// ⚠ ONE DELIBERATE DEVIATION, stated rather than hidden. The paper chart draws
// each arc as a single band with Treatment and Condition written above and
// below the tooth numbers, by hand, at an angle. That is not reproducible as a
// table, so each arc is rendered as three aligned rows — Treatment / Condition
// / tooth number — carrying exactly the same three facts per tooth, in the
// form's own arc order. Nothing is added, removed or renamed; only the
// geometry differs.
//
// ⚠ THE TREATMENT LEGEND IS THE FORM'S SIX, NOT THE APP'S NINE. The form
// prints FV, PFS, PF, TF, X, SDF. The app additionally uses OEX, OP and TR
// internally — printing those in the legend would put codes on a DOH form that
// the DOH form does not define.
const FORM_TREATMENT_LEGEND = [
  { code: 'FV', label: 'Fluoride Varnish' },
  { code: 'PFS', label: 'Pit and Fissure Sealant' },
  { code: 'PF', label: 'Permanent Filling' },
  { code: 'TF', label: 'Temporary Filling' },
  { code: 'X', label: 'Extraction' },
  { code: 'SDF', label: 'Silver Diamine Fluoride' },
];

/** The summary boxes printed under each chart. */
const TEMPORARY_SUMMARY = ['d', 'm', 'f', 'x'];
const PERMANENT_SUMMARY = ['D', 'M', 'F', 'X', 'T'];

function YearChart({ year, index }: { year: IptrYearData | null; index: number }) {
  const byTooth = new Map<number, { condition?: string; treatment_code?: string }>();
  for (const t of year?.toothRecords ?? []) byTooth.set(t.tooth_number, t);

  const cell = 'border border-black text-[7px] text-center h-3 w-[13px] leading-3';
  const rowLabel = 'text-[7px] pr-1 text-right whitespace-nowrap';

  const arc = (teeth: number[], label: string) => (
    <div className="mb-0.5">
      <table className="border-collapse">
        <tbody>
          <tr>
            <td className={rowLabel}>Treatment</td>
            {teeth.map((n) => (
              <td key={n} className={cell}>{byTooth.get(n)?.treatment_code ?? ''}</td>
            ))}
          </tr>
          <tr>
            <td className={rowLabel}>Condition</td>
            {teeth.map((n) => (
              <td key={n} className={cell}>{byTooth.get(n)?.condition ?? ''}</td>
            ))}
          </tr>
          <tr>
            <td className={`${rowLabel} italic`}>{label}</td>
            {teeth.map((n) => (
              <td key={n} className={`${cell} font-semibold bg-gray-100`}>{n}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );

  // Counts for the summary boxes, from that year's CONDITIONS (never treatment
  // codes — X is "indicated for extraction" as a condition and "extracted" as a
  // treatment, and the form's boxes are a dentition tally, not a service one).
  const count = (code: string) =>
    (year?.toothRecords ?? []).filter((t) => t.condition === code).length || '';

  return (
    <div className="border border-black p-1.5">
      <div className="flex items-center justify-between text-[8px] font-semibold">
        <span>Year {index + 1}:</span>
        <span>
          Date: <span className="border-b border-black inline-block min-w-[70px] text-center font-normal">
            {year ? year.iptr.school_year : ''}
          </span>
        </span>
      </div>
      <div className="mt-1">
        {arc(upperTemporary, 'temporary')}
        {arc(upperPermanent, 'permanent')}
        {arc(lowerPermanent, 'permanent')}
        {arc(lowerTemporary, 'temporary')}
      </div>
      <div className="mt-1 flex items-end gap-3">
        <table className="border-collapse">
          <tbody>
            <tr>{TEMPORARY_SUMMARY.map((c) => <td key={c} className="text-[7px] text-center w-[15px]">{c}</td>)}</tr>
            <tr>{TEMPORARY_SUMMARY.map((c) => (
              <td key={c} className="border border-black text-[7px] text-center h-3 w-[15px]">{count(c)}</td>
            ))}</tr>
          </tbody>
        </table>
        <table className="border-collapse">
          <tbody>
            <tr>{PERMANENT_SUMMARY.map((c) => <td key={c} className="text-[7px] text-center w-[15px]">{c}</td>)}</tr>
            <tr>{PERMANENT_SUMMARY.map((c) => (
              // T is the form's total column; it has no single condition code.
              <td key={c} className="border border-black text-[7px] text-center h-3 w-[15px]">{c === 'T' ? '' : count(c)}</td>
            ))}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function IptrFormPage2({ years }: { years: IptrYearData[] }) {
  const shown = years.slice(-YEAR_COLUMNS);
  const cols = Array.from({ length: YEAR_COLUMNS }, (_, i) => shown[i] ?? null);
  const legendTh = 'border border-black px-1 py-0.5 text-[8px] font-semibold text-center';
  const legendTd = 'border border-black px-1 py-0.5 text-[8px]';

  return (
    <div className="form-print bg-white text-black mx-auto p-6" style={{ width: 780 }}>
      <div className="text-[11px] font-bold">Dental Charting</div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {cols.map((y, i) => <YearChart key={i} year={y} index={i} />)}

        {/* The fifth chart sits alone on the paper form, with the two legends
            beside it — reproduced here rather than reflowed. */}
        <div className="space-y-2">
          <div>
            <div className="text-[8px] font-semibold text-center">Legend: Condition</div>
            <table className="w-full border-collapse mt-0.5">
              <thead>
                <tr>
                  <th className={legendTh}>Permanent</th>
                  <th className={legendTh}>Tooth Condition</th>
                  <th className={legendTh}>Temporary</th>
                </tr>
              </thead>
              <tbody>
                {conditionCodes.map((c) => (
                  <tr key={c.code}>
                    <td className={`${legendTd} text-center`}>{c.perm}</td>
                    <td className={legendTd}>{c.label}</td>
                    <td className={`${legendTd} text-center`}>{c.temp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-[8px] font-semibold text-center">Legend: Treatment</div>
            <table className="w-full border-collapse mt-0.5">
              <tbody>
                {FORM_TREATMENT_LEGEND.map((t) => (
                  <tr key={t.code}>
                    <td className={`${legendTd} text-center w-[40px]`}>{t.code}</td>
                    <td className={legendTd}>{t.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-6 w-1/2 text-center text-[9px]">
        <div className="border-t border-black pt-0.5">Signature of Examining Dentist</div>
      </div>
    </div>
  );
}
