import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { exportDohReportToPdf } from '../utils/exportPdf';

// ─── Parents/Guardian Consent Form ───────────────────────────────────────────
// Transcribed from the blank form the user supplied 2026-09-03
// (Parents_and_Guardian_Consent_Form.pdf).
//
// ⚠ THIS IS A BLANK FORM AND IT STAYS BLANK — the user's instruction was
// "blank consent form only". It is printed, sent home with the pupil, filled in
// by hand by the parent, and returned. Nothing here reads the database and
// nothing is pre-filled.
//
// That is not a limitation to "improve on" later without asking. A consent form
// carrying a child's name, birthday and contact number, printed in bulk and
// distributed through a school, is a very different privacy proposition from a
// blank sheet — and consent is precisely the thing that must be given, not
// assumed. If pre-filling is ever wanted, it needs the user's explicit call.
//
// ⚠ The supplied scan carries a HANDWRITTEN "Philhealth PN" note beside the
// GRADE&SECTION line. It is an annotation on that copy, NOT part of the printed
// form, so it is not reproduced here. If the clinic wants a PhilHealth field
// added, that is a change to the form and needs the dentist's say-so.
//
// The service list is verbatim, including its grade ranges — those are clinical
// eligibility rules (fluoride varnish is Kinder-Grade 1, sealant Grade 2-3) and
// must not be paraphrased.

const SERVICES: { label: string; note?: string }[] = [
  { label: 'ORAL EXAM O DENTAL CHECK UP', note: 'ITO AY TAUNANG GINAGAWA SA LAHAT NG MAG-AARAL.' },
  {
    label: 'TOPICAL FLUORIDE VARNISH APPLICATION (KINDER AT GRADE 1)',
    note: 'ITO AY PAGPAPAHID SA NGIPIN NG FLUORIDE. ANG FLUORIDE VARNISH AY TUMUTULONG PARA PATIBAYIN AT MAIWASAN ANG PAGKASIRA KAAGAD ANG NGIPIN.',
  },
  { label: 'PIT AND FISSURE SEALANT (GRADE 2 TO GRADE 3)', note: 'ITO AY PARA MAPROTEKTAHAN ANG BAGANG NA NGIPIN' },
  { label: 'ORAL PROPHYLAXIS O LINIS NG NGIPIN (GRADE 2 TO GRADE 6)' },
  { label: 'TOOTH RESTORATION O PASTA NG NGIPIN (GRADE 2 TO GRADE 6)' },
  {
    label: 'TOOTH EXTRACTION O BUNOT (KINDER TO GRADE 6)',
    note: 'KAILANGAN MAY KASAMANG MAGULANG/GUARDIAN ANG BATA SA ARAW NG BUNOT.',
  },
];

const MEDICAL: [string, string, string][] = [
  ['HEART DISEASE', 'DIABETES', 'CANCER'],
  ['THYROID PROBLEM', 'LEUKEMIA', 'ABNORMAL BLEEDING'],
  ['RESPIRATORY PROBLEM', 'EPILEPSY', 'NONE OF THE ABOVE'],
  ['TUBERCULOSIS/TB', 'HEPATITIS', ''],
];

/** An empty tick box, as printed. */
const Box = () => <span className="inline-block w-9 h-5 border border-black align-middle" />;
/** A ruled write-on line. */
const Line = ({ w = 'flex-1' }: { w?: string }) => (
  <span className={`${w} inline-block border-b border-black align-bottom h-4`} />
);

export const ConsentForm = () => {
  const printableRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const onPdf = async () => {
    if (!printableRef.current) return;
    setBusy(true);
    try {
      await exportDohReportToPdf(printableRef.current, 'Parents-Guardian-Consent-Form.pdf');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">Parents/Guardian Consent Form</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Blank form for printing and sending home. Nothing is pre-filled — the parent completes it by hand.
            </p>
          </div>
          <button
            onClick={onPdf}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 w-fit"
          >
            <Download className="w-3.5 h-3.5" />{busy ? 'Preparing…' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <div ref={printableRef} className="bg-white text-black p-8 mx-auto" style={{ width: 780, fontSize: 11, lineHeight: 1.5 }}>
          <h1 className="text-center font-bold tracking-wide" style={{ fontSize: 15 }}>
            PARENTS/GUARDIAN CONSENT FORM
          </h1>
          <p className="text-center mt-1">SCHOOL: <Line w="w-56" /></p>

          <div className="mt-5 space-y-1">
            <p className="flex items-end gap-2">NAME: <Line /> BIRTHDAY: <Line w="w-32" /></p>
            {/* The sub-labels sit UNDER the name rule on the paper form. */}
            <p className="flex gap-16 pl-16" style={{ fontSize: 9 }}>
              <span>SURNAME</span><span>FIRST NAME</span><span>MI</span>
            </p>
            <p className="flex items-end gap-2">
              GRADE&amp;SECTION: <Line w="w-40" /> AGE: <Line w="w-16" /> SEX: <Line w="w-16" /> CONTACT NO. <Line w="w-32" />
            </p>
          </div>

          <p className="mt-5 font-semibold">MAHAL NAMING MAGULANG/TAGAPAG ALAGA,</p>
          <p className="mt-2">
            ANG DENTISTA PO NG ATING SCHOOL CLINIC AY MAGSASAGAWA NG SERBISYONG DENTAL SA MGA MAG-AARAL AY MAY LAYUNING
            MAKAPAGBIGAY NG PREVENTIVE AT CURATIVE TREATMENT SA MGA MAG-AARAL.
          </p>
          <p className="mt-3">ANG MGA SERBISYONG DENTAL AY ANG MGA SUMUSUNOD:</p>

          <ul className="mt-2 space-y-1.5">
            {SERVICES.map((s) => (
              <li key={s.label}>
                <span className="flex items-start gap-2">
                  <span className="inline-block w-4 h-4 border border-black mt-0.5 shrink-0" />
                  <span className="font-medium">{s.label}</span>
                </span>
                {s.note && <span className="block pl-10" style={{ fontSize: 10 }}>{s.note}</span>}
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-1">
            <p className="flex items-end gap-2">
              <Line w="w-24" /> OO, PUMAPAYAG AKO NA MABIGYAN NG SERBISYONG DENTAL ANG AKING ANAK/APO/PAMANGKIN
            </p>
            <p className="flex items-end gap-2">
              <Line w="w-24" /> HINDI AKO PUMAPAYAG NA MABIGYAN NG SERBISYONG DENTAL ANG AKING ANAK/APO/PAMANGKIN
            </p>
          </div>

          <p className="mt-6 font-semibold">IKAW BA AY MAY MEDICAL HISTORY GAYA NG MGA SUMUSUNOD</p>
          <table className="mt-2 w-full">
            <tbody>
              {MEDICAL.map((row, i) => (
                <tr key={i}>
                  {row.map((label, j) => (
                    <td key={j} className="py-1 pr-4 align-middle" style={{ width: '33%' }}>
                      {label === '' ? (
                        <span className="flex items-end gap-2">OTHERS: <Line w="w-32" /></span>
                      ) : (
                        <span className="flex items-center justify-between gap-3">
                          <span>{label}</span><Box />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 flex items-end gap-2">ALLERGIES, ANO / SAAN? <Line /></p>

          <p className="mt-6 font-semibold">DENTAL HISTORY:</p>
          <div className="mt-2 pl-8 space-y-2">
            <span className="flex items-center gap-3">
              TOOTH ACHE <Box /> <span className="ml-8">BLEEDING OF GUMS</span> <Box />
            </span>
            <p className="flex items-end gap-2">LAST DENTAL VISIT: <Line w="w-64" /></p>
          </div>

          <div className="mt-12 flex justify-between gap-8">
            <span className="flex-1">
              <span className="block border-t border-black" />
              <span className="block" style={{ fontSize: 10 }}>PANGALAN NG MAGULANG/GUARDIAN</span>
            </span>
            <span className="w-56">
              <span className="block border-t border-black" />
              <span className="block text-center" style={{ fontSize: 10 }}>PETSA</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
