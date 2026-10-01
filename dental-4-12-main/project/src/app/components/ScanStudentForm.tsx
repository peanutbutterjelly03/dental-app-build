import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { CameraCapture } from './CameraCapture';
import { parseSpreadsheetRecords, normalizeSex, normalizeGrade } from '../utils/studentImport';
import { BLANK_NEW_PATIENT, type NewPatientForm } from './PatientList';
import type { IptrOcrFieldKey, IptrCheckboxFinding } from '../utils/iptrOcrShared';
import { batchProblem, isSpreadsheet, MAX_BATCH_FILES } from '../utils/ocrBatch';

// Full PAGE, not a modal (user, 2026-09-29: "restructure everything...
// doesn't have to be a pop up, make it a page... i want the same exact copy
// of this [the approved canvas design]. like everything including the font,
// spacing, sizing."). Markup, colors, spacing below are transcribed directly
// from the approved OCR Student Intake canvas's Main.dc.html -- same literal
// px values, not Tailwind's scale, so a side-by-side stays pixel-identical.
//
// Route: /students/scan. On success, hands the populated form to
// VerifyStudentForm.tsx (/students/scan/review) via router state -- nothing
// is ever saved from this page.

// Several forms at once (O3, 2026-10-01): each FILE is one student (see
// utils/ocrBatch.ts for why not each page). All are read first, then handed
// to Verify as a QUEUE that is reviewed one at a time.
export type ExtractedHandoff = {
  /** Set when this file could not be read: it still joins the queue, empty,
   *  so the encoder can type it or skip it, and the rest of the batch goes on. */
  readError?: string;
  newPatient: NewPatientForm;
  confidences: Partial<Record<IptrOcrFieldKey, number>>;
  extractedKeys: (keyof NewPatientForm)[];
  ocrSourceLabel: 'scanned form' | 'uploaded file';
  sourceFileName: string;
  sourcePreviewUrl: string | null;
  /** The IPTR Year 1-5 tick grid (O2b, 2026-10-01). Computed by the OCR but
   *  dropped here until now; absent for a spreadsheet upload. */
  ticks?: { findings: IptrCheckboxFinding[]; confidence: number; reason?: string };
};

const ACCEPT = 'image/png,image/jpeg,image/jpg,application/pdf,text/csv,.csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const ScanStudentForm = () => {
  const navigate = useNavigate();
  const { selectedSchool } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<'photo' | 'file' | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reading, setReading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    setError(null);
    setFiles((prev) => [...prev, ...list]);
    setSelectedMethod('file');
  };
  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i));

  const readError = (name: string, err: unknown) => (isSpreadsheet(name)
    ? (err instanceof Error ? err.message : 'Could not read the file. Check the column headers and try again.')
    : 'Could not read the image. Try a clearer photo or enter details manually.');

  const readOne = async (file: File): Promise<ExtractedHandoff> => {
      let handoff: ExtractedHandoff;
      if (isSpreadsheet(file.name)) {
        const [rec] = await parseSpreadsheetRecords(file);
        const get = (...keys: string[]) => { for (const k of keys) if (rec[k]) return rec[k]; return ''; };
        const sexRaw = get('sex', 'gender');
        const gradeRaw = get('grade_level', 'grade', 'gradelevel');
        const extractedKeys: (keyof NewPatientForm)[] = [];
        const set = (key: keyof NewPatientForm, value: string) => { if (value) extractedKeys.push(key); return value; };
        const fields: Partial<NewPatientForm> = {
          lastName: set('lastName', get('last_name', 'lastname', 'surname')),
          firstName: set('firstName', get('first_name', 'firstname', 'given_name')),
          middleName: set('middleName', get('middle_name', 'middlename')),
          birthdate: set('birthdate', get('birthday', 'birthdate', 'birth_date', 'date_of_birth')),
          gender: normalizeSex(sexRaw) ?? '',
          grade: (gradeRaw ? normalizeGrade(gradeRaw) : null) ?? '',
          section: get('section'),
          placeOfBirth: get('place_of_birth', 'placeofbirth', 'birthplace'),
          address: set('address', get('address')),
          contactNumber: set('contactNumber', get('contact_number', 'contact', 'contactnumber', 'phone')),
          guardianName: get('guardian_name', 'guardianname', 'parent_name'),
          guardianContact: get('guardian_contact', 'guardiancontact', 'guardian_contact_number'),
          guardianOccupation: get('occupation', 'guardian_occupation'),
          philhealthNumber: set('philhealthNumber', get('philhealth_number', 'philhealthnumber', 'philhealth_no', 'philhealth')),
        };
        if (normalizeSex(sexRaw)) extractedKeys.push('gender');
        if (gradeRaw && normalizeGrade(gradeRaw)) extractedKeys.push('grade');
        handoff = {
          newPatient: { ...BLANK_NEW_PATIENT, ...fields, school: selectedSchool ?? '' },
          confidences: {},
          extractedKeys,
          ocrSourceLabel: 'uploaded file',
          sourceFileName: file.name,
          sourcePreviewUrl: null,
        };
      } else {
        // Dynamic import keeps tesseract.js + pdfjs-dist (~1.5MB) out of the
        // main bundle -- only staff who actually scan a form download them.
        const { extractIptrFields } = await import('../utils/iptrOcr');
        const result = await extractIptrFields(file, setProgress);
        const f = result.fields;
        handoff = {
          newPatient: {
            ...BLANK_NEW_PATIENT,
            firstName: f.firstName ?? '', middleName: f.middleName ?? '', lastName: f.lastName ?? '',
            birthdate: f.birthdate ?? '', gender: f.gender ?? '', address: f.address ?? '',
            contactNumber: f.contactNumber ?? '', philhealthNumber: f.philhealthNumber ?? '',
            philhealthStatus: f.philhealthStatus ?? 'None',
            fourPsId: f.fourPsId ?? '', is4Ps: !!f.fourPsId,
            // grade/section/placeOfBirth/guardian* (2026-09-29): the printed-
            // form OCR path never filled these before, because the official
            // DOH IPTR genuinely has no such field. The grid extractor now
            // also reads the school's own custom "Patient Information Sheet"
            // (a different, boxed-layout form that DOES print all of these),
            // so whichever source was actually scanned gets whatever it has.
            grade: f.grade ?? '', section: f.section ?? '', placeOfBirth: f.placeOfBirth ?? '',
            guardianName: f.guardianName ?? '', guardianContact: f.guardianContact ?? '',
            guardianOccupation: f.guardianOccupation ?? '',
            school: selectedSchool ?? '',
          },
          confidences: result.confidences,
          extractedKeys: Object.keys(result.confidences) as (keyof NewPatientForm)[],
          ocrSourceLabel: 'scanned form',
          sourceFileName: file.name,
          sourcePreviewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          ticks: { findings: result.checkboxes, confidence: result.checkboxConfidence, reason: result.checkboxReason },
        };
      }
      return handoff;
  };

  const extract = async () => {
    if (!files.length) return;
    const problem = batchProblem(files.map((f) => f.name));
    if (problem) { setError(problem); return; }
    setError(null);
    setProcessing(true);
    try {
      // One file: exactly as before, a read failure stays on this page.
      if (files.length === 1) {
        setReading(0);
        setProgress(0);
        try {
          const handoff = await readOne(files[0]);
          navigate('/students/scan/review', { state: { queue: [handoff] } });
        } catch (err) {
          setError(readError(files[0].name, err));
        }
        return;
      }
      // A batch: one after another (the OCR worker is heavy), and a file that
      // cannot be read joins the queue empty, with its reason.
      const queue: ExtractedHandoff[] = [];
      for (const [i, file] of files.entries()) {
        setReading(i);
        setProgress(0);
        try {
          queue.push(await readOne(file));
        } catch (err) {
          queue.push({
            readError: readError(file.name, err),
            newPatient: { ...BLANK_NEW_PATIENT, school: selectedSchool ?? '' },
            confidences: {}, extractedKeys: [], ocrSourceLabel: 'scanned form',
            sourceFileName: file.name,
            sourcePreviewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          });
        }
      }
      navigate('/students/scan/review', { state: { queue } });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{ background: '#F6F9FC', minHeight: '100%', padding: '2.5rem 3.5rem', fontFamily: 'var(--font-sans)', color: '#141413' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
        <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '1rem', background: '#F4F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="23.8" height="23.8" viewBox="0 0 24 24" fill="none" stroke="#273A78" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5a2 2 0 0 1 2-2h2"/><path d="M4 17v2a2 2 0 0 0 2 2h2"/><path d="M20 7V5a2 2 0 0 0-2-2h-2"/><path d="M20 17v2a2 2 0 0 1-2 2h-2"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <div>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#67687A' }}>Students &middot; OCR</div>
          <h1 style={{ margin: '0.125rem 0 0', fontSize: '1.625rem', fontWeight: 700 }}>Scan a Student Form</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#67687A' }}>Capture a photo of the DOH IPTR form, or upload a file. Matching fields will be filled in for you to verify.</p>
        </div>
      </div>

      {/* Two entry options -- hoverable, and the clicked one gets a dark
          blue BORDER only (user, 2026-09-29: "not the solid dark blue
          filled, just the border"). Neither tile is "selected" by default;
          picking one is what starts that action (camera / file picker) AND
          marks it. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
        {(['photo', 'file'] as const).map((method) => {
          const active = selectedMethod === method;
          const isPhoto = method === 'photo';
          return (
            <button
              key={method}
              type="button"
              className="transition-shadow hover:shadow-md"
              onClick={() => {
                setSelectedMethod(method);
                if (isPhoto) setShowCamera(true); else fileInputRef.current?.click();
              }}
              style={{
                boxSizing: 'border-box', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.625rem',
                padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 0.0625rem 0.125rem rgba(15,23,42,0.06)',
                textAlign: 'left', font: 'inherit', background: '#fff', color: 'inherit',
                border: active ? '0.125rem solid #273A78' : '0.125rem solid #E2E8F0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '2.75rem', height: '2.75rem', borderRadius: '0.75rem', background: isPhoto ? '#F4F7FF' : '#ECECF0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isPhoto ? (
                    <svg width="18.7" height="18.7" viewBox="0 0 24 24" fill="none" stroke="#273A78" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>
                  ) : (
                    <svg width="18.7" height="18.7" viewBox="0 0 24 24" fill="none" stroke="#141413" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                  )}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>{isPhoto ? 'Take a Photo' : 'Upload a File'}</div>
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#67687A', textAlign: 'left' }}>
                {isPhoto ? "Use this device's camera to capture the form directly." : 'Choose an existing photo, scan, spreadsheet or document.'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Dropzone / selected file */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
        style={{ minHeight: '13.75rem', background: '#fff', border: '0.125rem dashed #E2E8F0', borderRadius: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.875rem', padding: '1.5rem', textAlign: 'center', cursor: 'pointer' }}
      >
        {files.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '18rem', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', background: '#F6F9FC', border: '0.0625rem solid #E2E8F0', borderRadius: '0.75rem', padding: '0.75rem 1rem' }}>
                <div style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.625rem', background: '#ECECF0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#141413" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="15.3" height="15.3" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                </div>
                <div style={{ textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, wordBreak: 'break-word' }}>{file.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#67687A' }}>{(file.size / (1024 * 1024)).toFixed(1)} MB &middot; ready to extract</div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={processing}
                  onClick={() => removeFile(i)}
                  style={{ cursor: 'pointer', marginLeft: 'auto', width: '1.625rem', height: '1.625rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#67687A', background: 'none', border: 'none', flexShrink: 0 }}
                >
                  <svg width="13.6" height="13.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            <svg width="27.2" height="27.2" viewBox="0 0 24 24" fill="none" stroke="#67687A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <div style={{ fontSize: '0.875rem', color: '#67687A', fontWeight: 500 }}>Drop files here</div>
          </>
        )}
        <div style={{ fontSize: '0.8125rem', color: '#67687A' }}>
          {files.length ? 'or drag more files here, or click to add' : `or click to browse. Choose up to ${MAX_BATCH_FILES} forms; each file is one student.`}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', justifyContent: 'center', maxWidth: '35rem' }}>
          {['.jpg', '.jpeg', '.png', '.pdf', '.xlsx', '.csv'].map((ext) => (
            <span key={ext} style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#67687A', background: '#ECECF0', borderRadius: '62.4375rem', padding: '0.1875rem 0.625rem' }}>{ext}</span>
          ))}
        </div>
        <input
          ref={fileInputRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
      </div>


      {/* Status slot — always reserves its height so the spacing above the footer buttons is the same before, during and after extraction */}
      <div style={{ minHeight: '1.125rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.8125rem', color: '#67687A' }}>
        {processing && (
          <>
            <span style={{ width: '1.125rem', height: '1.125rem', borderRadius: '50%', border: '0.1875rem solid #F4F7FF', borderTopColor: '#273A78', display: 'inline-block', animation: 'fl-spin 0.8s linear infinite' }} />
            <style>{'@keyframes fl-spin { to { transform: rotate(360deg); } }'}</style>
            {files.length > 1 ? `Reading form ${reading + 1} of ${files.length}… ${progress}%` : `Scanning form… ${progress}%`}
          </>
        )}
        {!processing && error && <span style={{ color: '#BE123C' }}>{error}</span>}
      </div>

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
        <button
          type="button"
          onClick={() => navigate('/patients')}
          style={{ cursor: 'pointer', boxSizing: 'border-box', padding: '0.6875rem 1.25rem', borderRadius: '0.625rem', fontSize: '0.875rem', fontWeight: 600, color: '#141413', border: '0.0625rem solid #E2E8F0', background: '#fff' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={extract}
          disabled={!files.length || processing}
          style={{ cursor: !files.length || processing ? 'not-allowed' : 'pointer', opacity: !files.length || processing ? 0.5 : 1, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6875rem 1.375rem', borderRadius: '0.625rem', fontSize: '0.875rem', fontWeight: 700, background: '#273A78', color: '#fff', border: 'none' }}
        >
          {files.length > 1 ? `Extract ${files.length} Forms` : 'Extract Information'}
          <svg width="13.6" height="13.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>

      {showCamera && (
        <CameraCapture
          onClose={() => setShowCamera(false)}
          onCapture={(f) => { setShowCamera(false); addFiles([f]); }}
        />
      )}
    </div>
  );
};
