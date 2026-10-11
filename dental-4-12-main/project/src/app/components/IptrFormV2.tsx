import type { ApiStudent } from '../api/types';
import { usePrintOrientation } from '../hooks/usePrintOrientation';
import type { IptrYearData } from '../hooks/useDentalChartData';
import { formatDate } from '../utils/localDate';
import { sectionBRows, type ChartedTooth } from '../../../shared/iptrSectionB';

// ─── FORM 1 — INDIVIDUAL TREATMENT RECORD (Sprint 137) ─────────────────────
//
// The SECOND valid IPTR. The user confirmed 2026-09-05 that this and the
// Taguig City Health Office "Individual PATIENT Treatment Record" (Appendix G,
// built in Sprints 135-136) are BOTH in use — neither supersedes the other, so
// the app offers both and merges neither. A merged form would be a third
// document that is filed nowhere.
//
// Built from the user's photograph of the blank/filled sheet, 2026-09-05.
// ⚠ That photo shows a real pupil's name, birth date and findings, so it is
// NOT committed to the repo. If a scan is ever added, blank the handwriting
// first — this repo is public and these are the exact fields the database
// encrypts.
//
// ⚠ It is "Form 1", not "Form 3" — backlog #37 recorded the wrong number.
//
// HOW IT DIFFERS from the Appendix G form, which is why they are two documents:
//   · its year columns are headed "Age", not "Year 1-5"
//   · its history is 16 yes/no questions in Filipino (Oo / Hindi / Remarks),
//     not the checkbox blocks
//   · it carries a School line and a Place of Birth
//   · its services table is a per-visit tick grid, not Diagnosis/Treatment text

const AGE_COLUMNS = 5;

/** Section B's labels AS THIS FORM PRINTS THEM — lower-case "teeth", "present",
 *  "dfx". The shared derivation supplies the numbers and its own labels; the
 *  form supplies the wording, and the form wins on the form. Same order. */
const FORM1_SECTION_B_LABELS = [
  'No. of Permanent Teeth present',
  'No. of Permanent Sound Teeth',
  'No. of Decayed teeth (D)',
  'No. of Missing Teeth (M)',
  'No. of Filled Teeth (F)',
  'No. of Teeth for Extraction (X)',
  'No. of DMFX Teeth',
  'No. of Temporary Teeth Present',
  'No. of Temporary Sound Teeth',
  'No. of decayed teeth (d)',
  'No. of filled teeth (f)',
  'No. of Teeth for Extraction (x)',
  'No. of dfx teeth',
];

/** The 16 printed questions, verbatim including the sheet's own spelling.
 *  `source` maps one to a stored field; null means the system holds no answer
 *  and the row prints EMPTY — never a guessed "Hindi", which on a medical
 *  history is a clinical claim.
 *
 *  ⚠ ONLY UNAMBIGUOUS MAPPINGS ARE MADE. "Sakit sa atay" is left unmapped even
 *  though MEDICAL_HISTORY has `hepatitis_disorders`: hepatitis is a liver
 *  disease, but "may sakit sa atay" is a broader question, and answering it
 *  from a narrower field would put a clinical assertion on a signed form.
 *  The dentist should decide those mappings, not this file. */
const HISTORY_QUESTIONS: { n: number; q: string; source: ((y: IptrYearData) => boolean | null) | null }[] = [
  { n: 1, q: 'Mayroon ka bang diabetes?', source: (y) => y.medicalHistory?.diabetes_mellitus ?? null },
  { n: 2, q: 'Mayroon ka bang sakit sa puso?', source: (y) => y.medicalHistory?.cardiovascular_disease ?? null },
  { n: 3, q: 'Mayroon ka bang sakit sa atay?', source: null },
  { n: 4, q: 'Ikaw ba ay kulang sa dugo?', source: null },
  { n: 5, q: 'Mataas ba ang presyon ng iyong dugo? Ano?', source: (y) => y.medicalHistory?.hypertension ?? null },
  { n: 6, q: 'Mayroon ka bang allergy sa pagkain? Sa gamot? Ano?', source: (y) => (y.medicalHistory?.allergies ? true : null) },
  { n: 7, q: 'Mayroon ka bang allergy sa pamamanhid (anesthesia)?', source: null },
  { n: 8, q: 'Ikaw ba ay nabunutan na ng ngipin?', source: null },
  { n: 9, q: 'Ikaw ba ay madugo kapag binubunutan ng ngipin?', source: null },
  { n: 10, q: 'Naninikip ba ang iyong dibdib? / meadaling mapagod?', source: null },
  { n: 11, q: 'Mayroon ka bang hika?', source: null },
  { n: 12, q: 'Mayroon ka bang regla? (para sa babae)', source: null },
  { n: 13, q: 'Ikaw ba ay buntis?', source: null },
  { n: 14, q: 'Ikaw ba ay naospital na?', source: (y) => y.medicalHistory?.previous_hospitalization ?? null },
  { n: 15, q: 'Ikaw ba ay may iniinom na gamot sa kasalukuyan?', source: null },
  { n: 16, q: 'Ikaw ba ay may epilepsy?', source: null },
];

/** Reproduced verbatim — it is what the patient or guardian signs under. */
const CONSENT_TEXT =
  'Ako ang nakalagda sa ibaba ay sumasang-ayon na mapasa ilalim sa (bunot, pasta, linis ng ngipin). ' +
  'Lahat ng isasagot ko dito ay katoohanan lamang kaya anuman ang mangyari, ang dentist ay walang pananagutan sa kahit ano pa man.';

/** The services grid's own column order and spelling ("Flouride" is the
 *  sheet's). `code` is the TOOTH_RECORD treatment code that fills it; null
 *  means the system has no source and the column stays blank. */
const SERVICE_COLUMNS: { label: string; code: string | null }[] = [
  { label: 'Oral Prophylaxis', code: 'OP' },
  { label: 'Temporary Filling', code: 'TF' },
  { label: 'Permanent Filling', code: 'PF' },
  { label: 'Sealant', code: 'PFS' },
  { label: 'Extraction', code: 'X' },
  { label: 'Flouride', code: 'FV' },
  { label: 'Consultation', code: null },
  { label: 'Others', code: null },
  { label: 'Signature', code: null },
];

const NO_SOURCE_NOTE =
  'Place of Birth · Occupation · Consultation · Others · Signature, and history questions 3, 4, 7, 8, 9, 10, 11, 12, 13, 15 and 16 — ' +
  'these are on the printed form and the system stores no answer for them, so they print blank rather than a guessed "Hindi". ' +
  'The unmapped questions need the dentist to decide which stored field, if any, answers each.';

interface Props {
  student: ApiStudent;
  schoolName: string;
  /** Newest last, as `useDentalChartData` returns them. */
  years: IptrYearData[];
}

export function IptrFormV2({ student, schoolName, years }: Props) {
  // → Built at a fixed 1040px — wider than any portrait sheet.
  usePrintOrientation('landscape');
  /** That year's saved tooth records in the shared derivation's shape. */
  const chartedFor = (y: IptrYearData | null): ChartedTooth[] =>
    (y?.toothRecords ?? []).map((t) => ({
      tooth: t.tooth_number,
      condition: t.condition,
      treatment: t.treatment_code,
    }));

  const shown = years.slice(-AGE_COLUMNS);
  const cols = Array.from({ length: AGE_COLUMNS }, (_, i) => shown[i] ?? null);

  /** The pupil's age during that school year — the form heads its columns with
   *  an AGE, not a year number, so it is computed at the school year's start
   *  (June 1) rather than today. */
  const ageInYear = (y: IptrYearData | null) => {
    if (!y || !student.birthday) return '';
    const startYear = Number(y.iptr.school_year.slice(0, 4));
    if (!Number.isFinite(startYear)) return '';
    const on = new Date(startYear, 5, 1);
    const b = new Date(student.birthday);
    if (Number.isNaN(b.getTime())) return '';
    let a = on.getFullYear() - b.getFullYear();
    const m = on.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && on.getDate() < b.getDate())) a--;
    return a >= 0 ? String(a) : '';
  };

  /** ✓ present / ✗ absent, per the form's own "Check (/) if present (x) if
   *  absent" instruction. A year with no record at all stays EMPTY — neither
   *  present nor absent is known, and printing ✗ would assert it was checked. */
  const mark = (y: IptrYearData | null, v: boolean | null | undefined) => {
    if (!y || v === null || v === undefined) return '';
    return v ? '✓' : '✗';
  };

  /** ⚠ A COUNTED ZERO IS PRINTED; AN UNCHARTED YEAR IS BLANK. The section is
   *  headed "B. Indicate Number", so 0 is an answer — "no decayed teeth" — and
   *  suppressing it would lose that. But a year with no dental chart was never
   *  examined, and printing 0 there would claim it was. */
  const counted = (y: IptrYearData | null, n: number) => (y && y.dentalChart ? String(n) : '');

  const conditionCount = (y: IptrYearData | null, code: string) =>
    counted(y, y ? y.toothRecords.filter((t) => t.condition === code).length : 0);

  /** ⚠ DENTITION IS DECIDED BY THE TOOTH NUMBER, not by the letter case of the
   *  condition. `✓` (Sound/Sealed) is the SAME character in both dentitions, so
   *  a case test cannot tell a sound baby tooth from a sound adult one — it
   *  would have put every sound tooth in the permanent column. FDI numbers
   *  51-55, 61-65, 71-75 and 81-85 are the primary teeth. */
  const isTemporary = (toothNumber: number) => {
    const q = Math.floor(toothNumber / 10);
    return q >= 5 && q <= 8;
  };

  /** Teeth of one dentition that carry a record and are neither Missing nor
   *  Unerupted — the closest the data comes to "teeth present". ⚠ It counts
   *  CHARTED teeth: a tooth nobody charted is not counted, which is why this
   *  is a floor, not a census. */
  const presentCount = (y: IptrYearData | null, permanent: boolean) => {
    if (!y) return '';
    const gone = ['M', 'Un', 'm', 'un'];
    const n = y.toothRecords.filter(
      (t) => t.condition && isTemporary(t.tooth_number) !== permanent && !gone.includes(t.condition),
    ).length;
    return counted(y, n);
  };

  /** Sound teeth in one dentition — same reason as above: `✓` alone is
   *  ambiguous, the tooth number is not. */
  const soundCount = (y: IptrYearData | null, permanent: boolean) => {
    if (!y) return '';
    const n = y.toothRecords.filter(
      (t) => t.condition === '✓' && isTemporary(t.tooth_number) !== permanent,
    ).length;
    return counted(y, n);
  };

  const sumCounts = (y: IptrYearData | null, codes: string[]) => {
    if (!y) return '';
    const n = y.toothRecords.filter((t) => t.condition && codes.includes(t.condition)).length;
    return counted(y, n);
  };

  // One services row per charting date, with the codes recorded that day.
  const serviceRows = years
    .filter((y) => y.dentalChart)
    .map((y) => ({
      date: y.dentalChart!.date_charted,
      codes: new Set(y.toothRecords.map((t) => t.treatment_code).filter(Boolean) as string[]),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const cell = 'border border-black px-1 py-0.5 text-[8px]';
  const head = 'border border-black px-1 py-0.5 text-[8px] font-semibold text-center';
  const line = 'border-b border-black inline-block';
  const svcHead = 'border border-black px-0.5 py-0.5 text-[6.5px] font-semibold text-center leading-tight';
  const svcCell = 'border border-black px-0.5 py-0.5 text-[6.5px]';

  const statusRow = (label: string, get: (y: IptrYearData | null) => string, bold = false) => (
    <tr key={label}>
      <td className={`${cell} ${bold ? 'font-semibold' : ''}`}>{label}</td>
      {cols.map((y, i) => <td key={i} className={`${cell} text-center`}>{get(y)}</td>)}
    </tr>
  );

  return (
    <div className="form-print bg-white text-black mx-auto p-6" style={{ width: 1040 }}>
      <div className="grid grid-cols-2 gap-6">
        {/* ── LEFT PAGE ─────────────────────────────────────────────────── */}
        <div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${head} text-left`}>Patient&apos;s Medical and Dental History</th>
                <th className={`${head} w-[34px]`}>Oo</th>
                <th className={`${head} w-[34px]`}>Hindi</th>
                <th className={`${head} w-[70px]`}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY_QUESTIONS.map((q) => {
                // The history is asked once, so the most recent year answers it.
                const latest = shown[shown.length - 1] ?? null;
                const v = latest && q.source ? q.source(latest) : null;
                const remark =
                  q.n === 6 && latest?.medicalHistory?.allergies ? latest.medicalHistory.allergies : '';
                return (
                  <tr key={q.n}>
                    <td className={cell}>{q.n}. {q.q}</td>
                    <td className={`${cell} text-center`}>{v === true ? '✓' : ''}</td>
                    <td className={`${cell} text-center`}>{v === false ? '✓' : ''}</td>
                    <td className={cell}>{remark}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-3 text-[8px] leading-snug">{CONSENT_TEXT}</p>

          <div className="mt-8 grid grid-cols-2 gap-4 text-[8px]">
            <div><div className="border-t border-black pt-0.5">Lagda at Pangalan ng Pasyente</div></div>
            <div><div className="border-t border-black pt-0.5">For Minor: Lagda ng Magulang</div></div>
          </div>

          <div className={`${head} mt-4 border-b-0`}>SERVICES RENDERED</div>
          {/* ⚠ Ten columns inside a half-width page: at the shared `head`/`cell`
              sizes this table overflowed into the RIGHT page of the form. Its
              own tighter type and padding keep it inside its half, which is
              where the paper form keeps it. */}
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr>
                <th className={svcHead}>Date</th>
                {SERVICE_COLUMNS.map((c) => <th key={c.label} className={svcHead}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {serviceRows.map((r) => (
                <tr key={r.date}>
                  <td className={`${svcCell} whitespace-nowrap`}>{formatDate(r.date)}</td>
                  {SERVICE_COLUMNS.map((c) => (
                    <td key={c.label} className={`${svcCell} text-center`}>
                      {c.code && r.codes.has(c.code) ? '✓' : ''}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Ruled blank lines, as printed, so the sheet is usable chairside. */}
              {Array.from({ length: Math.max(0, 10 - serviceRows.length) }).map((_, i) => (
                <tr key={`b${i}`}>
                  {Array.from({ length: SERVICE_COLUMNS.length + 1 }).map((__, j) => (
                    <td key={j} className={`${svcCell} h-3`} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── RIGHT PAGE ────────────────────────────────────────────────── */}
        <div>
          <div className="flex justify-between text-[8px]">
            <div>
              <div>Form 1</div>
              <div>Philhealth File No: <span className={`${line} min-w-[60px]`}>{student.philhealth_number ?? ''}</span></div>
            </div>
            <div className="text-right leading-tight">
              <div>REPUBLIC OF THE PHILIPPINES</div>
              <div>DEPARTMENT OF HEALTH</div>
              <div>CENTER FOR HEALTH DEVELOPMENT</div>
            </div>
          </div>

          <div className="mt-3 text-center">
            <div className={`${line} w-full text-[10px]`}>{schoolName}</div>
            <div className="text-[8px]">School</div>
            <div className="mt-2 text-[11px] font-bold">INDIVIDUAL TREATMENT RECORD</div>
          </div>

          <div className="mt-3 text-[8px] space-y-1">
            <div className="flex gap-2">
              <span>Name:</span>
              <span className={`${line} flex-1`}>{student.last_name}</span>
              <span className={`${line} flex-1`}>{student.first_name}</span>
              <span className={`${line} w-10`}>{student.middle_name ?? ''}</span>
            </div>
            <div className="flex gap-2 text-[7px]">
              <span className="w-10" />
              <span className="flex-1 text-center">Surname/Apelyido</span>
              <span className="flex-1 text-center">First Name/Pangalan</span>
              <span className="w-10 text-center">M.I.</span>
            </div>
            <div className="flex gap-2">
              <span>Date of Birth:</span>
              <span className={`${line} flex-1`}>{student.birthday ? formatDate(student.birthday) : ''}</span>
              <span>Age:</span>
              <span className={`${line} w-12`}>{ageInYear(shown[shown.length - 1] ?? null)}</span>
            </div>
            {/* No model stores a place of birth — printed blank, never omitted. */}
            <div className="flex gap-2">
              <span>Place of Birth:</span>
              <span className={`${line} flex-1`} />
              <span>Sex: M</span>
              <span className={`${line} w-8 text-center`}>{student.sex?.startsWith('M') ? '✓' : ''}</span>
              <span>F</span>
              <span className={`${line} w-8 text-center`}>{student.sex?.startsWith('F') ? '✓' : ''}</span>
            </div>
            <div className="flex gap-2"><span>Address:</span><span className={`${line} flex-1`}>{student.address ?? ''}</span></div>
            <div className="flex gap-2"><span>Occupation:</span><span className={`${line} flex-1`} /></div>
          </div>

          <table className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>ORAL HEALTH STATUS</th>
                {cols.map((y, i) => <th key={i} className={head}>Age {ageInYear(y)}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${cell} font-semibold text-center`} colSpan={AGE_COLUMNS + 1}>
                  A. Check (/) if present (x) if absent
                </td>
              </tr>
              {statusRow('Date of Oral Exaination', (y) =>
                y?.dentalChart ? formatDate(y.dentalChart.date_charted) : '')}
              {statusRow('Dental Caries', (y) =>
                mark(y, y ? y.toothRecords.some((t) => t.condition === 'D' || t.condition === 'd') : null))}
              {/* ONE row on this form where the model has TWO booleans — either
                  one makes it present, which is the same rule the DOH
                  Consolidated report uses for debris/calculus. */}
              {statusRow('Gingivitis/Periodontal Disease', (y) =>
                mark(y, y?.oralCondition ? (y.oralCondition.gingivitis || y.oralCondition.periodontal_disease) : null))}
              {statusRow('Debris', (y) => mark(y, y?.oralCondition?.debris ?? null))}
              {statusRow('Calculus', (y) => mark(y, y?.oralCondition?.calculus ?? null))}
              {statusRow('Abnormal Growth', (y) => mark(y, y?.oralCondition?.abnormal_growth ?? null))}
              {statusRow('Cleft Lip / Palate', (y) => mark(y, y?.oralCondition?.cleft_lip_palate ?? null))}
              {statusRow('Others (Supernumerary/meslodens)', (y) => y?.oralCondition?.others ?? '')}
              <tr>
                <td className={`${cell} font-semibold text-center`} colSpan={AGE_COLUMNS + 1}>B. Indicate Number</td>
              </tr>
              {/* ⚠ Sprint 151 — these rows come from `shared/iptrSectionB.ts`, the
                  SAME derivation the Dental Chart tab's summary panel uses. They
                  were computed separately here before, which is two
                  implementations of one official form's arithmetic: the screen
                  and the sheet filed with the City Health Office could disagree
                  about the same pupil. Row labels stay exactly as this form
                  prints them, which is why they are listed rather than taken
                  from the shared row set. */}
              {sectionBRows(chartedFor(cols[0])).map((row, i) => (
                <tr key={row.label}>
                  <td className={cell}>{FORM1_SECTION_B_LABELS[i] ?? row.label}</td>
                  {cols.map((y, ci) => {
                    const rows = sectionBRows(chartedFor(y));
                    return (
                      <td key={ci} className={`${cell} text-center`}>
                        {y && y.dentalChart ? String(rows[i]?.teeth.length ?? 0) : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* On screen only — never on paper. */}
      <p className="print-hide mt-2 text-[10px] leading-relaxed text-muted-foreground">{NO_SOURCE_NOTE}</p>
    </div>
  );
}
