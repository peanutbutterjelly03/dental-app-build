import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { useSchools } from '../hooks/useSchools';
import { PreviewModal } from './PreviewModal';
import { apiClient, ApiError } from '../api/client';
import { schoolYearLabel } from '../utils/schoolYear';
import { GRADES } from './PromoteAssign';
import {
  BLANK_NEW_PATIENT, REQUIRED_STUDENT_FIELDS, duplicatesFromError,
  type NewPatientForm, type DuplicateCandidate,
} from './PatientList';
import type { IptrCheckboxFinding } from '../utils/iptrOcrShared';
import { tickBodies, tickKind, tickKey, defaultTickYear } from '../utils/ocrTickFindings';
import { batchSummary, type BatchOutcome } from '../utils/ocrBatch';
import type { ExtractedHandoff } from './ScanStudentForm';
// Same shared value-format rules the manual Add Student form and the server use.
import { validateStudentValues } from '../../../shared/studentValidation';
import { calculateAge } from '../utils/age';

// Full PAGE, not a modal (see ScanStudentForm.tsx for the fuller rationale).
// Markup, colors and spacing transcribed directly from the approved OCR
// Student Intake canvas's Review.dc.html. Route: /students/scan/review,
// reached only via router state handed off by ScanStudentForm -- there is
// nothing to verify without it, so a direct/refreshed visit bounces back.


const SECTION_TITLES: Record<IptrCheckboxFinding['section'], string> = {
  medical: 'Medical History',
  dietary: 'Dietary Habits and Social History',
  oral: 'Oral Health Condition',
};

// calculateAge: the shared one (BUG-02). Same null-on-bad-date behaviour as the
// local copy it replaces.

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', padding: '0.5625rem 0.75rem', border: '0.0625rem solid #E2E8F0',
  borderRadius: '0.625rem', fontSize: '0.84375rem', fontFamily: 'inherit', color: '#141413', background: '#fff',
};

const Label = ({ children, extracted, required }: { children: React.ReactNode; extracted?: boolean; required?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.78125rem', fontWeight: 600, color: '#33344a', marginBottom: '0.375rem' }}>
    {children} {required && <span style={{ color: '#BE123C' }}>*</span>}
    {extracted && (
      <span style={{ fontSize: '0.59375rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#15803D', background: '#F0FDF4', border: '0.0625rem solid rgba(21,128,61,0.25)', borderRadius: '62.4375rem', padding: '0.0625rem 0.4375rem' }}>
        Extracted
      </span>
    )}
  </div>
);

// The route reads a QUEUE (O3, 2026-10-01): one scanned file is a queue of one
// and behaves exactly as before (save opens the pupil's chart); a batch is
// reviewed one form at a time with Save & next / Skip, then a summary.
export const VerifyStudentForm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queue = (location.state as { queue?: ExtractedHandoff[] } | null)?.queue ?? null;
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);

  // No queue (direct visit, or a page refresh: router state doesn't survive
  // one) means there's nothing to verify.
  useEffect(() => { if (!queue?.length) navigate('/students/scan', { replace: true }); }, [queue, navigate]);
  if (!queue?.length) return null;

  const done = (outcome: BatchOutcome) => {
    const all = [...outcomes, outcome];
    if (index + 1 < queue.length) {
      setOutcomes(all);
      setIndex(index + 1);
      window.scrollTo(0, 0);
      return;
    }
    toast.success(batchSummary(all));
    navigate('/patients');
  };

  return (
    <VerifyOne
      key={index}
      handoff={queue[index]}
      position={queue.length > 1 ? { index, total: queue.length } : null}
      onDone={done}
    />
  );
};

const VerifyOne = ({ handoff, position, onDone }: {
  handoff: ExtractedHandoff;
  /** Where this form sits in a batch; null for a single scan. */
  position: { index: number; total: number } | null;
  onDone: (outcome: BatchOutcome) => void;
}) => {
  const navigate = useNavigate();
  const { selectedSchool } = useAuth();
  const toast = useToast();
  const { schools } = useSchools();

  const [form, setForm] = useState<NewPatientForm>(handoff.newPatient ?? BLANK_NEW_PATIENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<keyof NewPatientForm>>(new Set());
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [showSourcePreview, setShowSourcePreview] = useState(false);
  // The IPTR tick grid (O2b, 2026-10-01). Every finding starts UNCHECKED and
  // the Year select defaults to the latest column with ticks (user decisions).
  const tickFindings = handoff.ticks?.findings ?? [];
  const [tickYear, setTickYear] = useState(() => defaultTickYear(tickFindings));
  const [acceptedTicks, setAcceptedTicks] = useState<Set<string>>(new Set());
  const toggleTick = (key: string) => setAcceptedTicks((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const isExtracted = (key: keyof NewPatientForm) =>
    key in handoff.confidences || handoff.extractedKeys.includes(key);

  const update = (key: keyof NewPatientForm, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setMissing((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });
  };

  const age = calculateAge(form.birthdate);

  const save = async (confirmDuplicate = false) => {
    setError(null);
    if (!confirmDuplicate) {
      const missingFields = REQUIRED_STUDENT_FIELDS
        .filter(({ onlyIf }) => (onlyIf ? onlyIf(form) : true))
        .filter(({ key }) => !String(form[key] ?? '').trim());
      if (missingFields.length) {
        setMissing(new Set(missingFields.map((m) => m.key)));
        setError(`Please fill in: ${missingFields.map((m) => m.label).join(', ')}.`);
        return;
      }
      setMissing(new Set());
      const valueProblems = validateStudentValues({
        lastName: form.lastName, firstName: form.firstName, middleName: form.middleName,
        birthdate: form.birthdate, contactNumber: form.contactNumber, guardianContact: form.guardianContact,
      });
      if (valueProblems.length) { setError(valueProblems.join(' ')); return; }
    }
    const school = schools.find((s) => s.school_name === (form.school || selectedSchool));
    if (!school) { setError('Selected school not found.'); return; }
    setSaving(true);
    try {
      const created = await apiClient.post<{ _id: string }>('/students', {
        school_id: school._id,
        last_name: form.lastName, first_name: form.firstName, middle_name: form.middleName,
        birthday: form.birthdate, sex: form.gender, address: form.address, contact_number: form.contactNumber,
        grade_level: form.grade, section: form.section, is_not_student: form.isNotStudent,
        place_of_birth: form.placeOfBirth, guardian_name: form.guardianName, guardian_contact: form.guardianContact,
        guardian_occupation: form.guardianOccupation, philhealth_number: form.philhealthNumber,
        philhealth_status: form.philhealthNumber.trim() ? form.philhealthStatus : 'None',
        is_4ps: form.is4Ps, fourps_id: form.fourPsId,
        ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
      });
      let iptrId: string | null = null;
      try {
        const iptr = await apiClient.post<{ _id: string }>('/student-iptrs', {
          student_id: created._id, school_year: schoolYearLabel(),
          grade_level: form.isNotStudent ? null : form.grade, section: form.isNotStudent ? null : form.section,
          consent_status: form.consentStatus,
        });
        iptrId = iptr?._id ?? null;
      } catch { /* best-effort -- the chart's own "Add Year" still works */ }
      // The accepted ticks go into THIS school year's records. A section with
      // nothing accepted gets no record (see tickBodies). The student is
      // already saved, so a failure here is reported, never silent.
      const bodies = tickBodies(tickFindings, tickYear, acceptedTicks);
      if (Object.keys(bodies).length) {
        const writes: Promise<unknown>[] = [];
        if (iptrId) {
          if (bodies.medical) writes.push(apiClient.post('/medical-histories', { iptr_id: iptrId, ...bodies.medical }));
          if (bodies.dietary) writes.push(apiClient.post('/dietary-social-habits', { iptr_id: iptrId, ...bodies.dietary }));
          if (bodies.oral) writes.push(apiClient.post('/oral-health-conditions', { iptr_id: iptrId, oral_hygiene: 'Not assessed', ...bodies.oral }));
        }
        const failed = !iptrId || (await Promise.allSettled(writes)).some((r) => r.status === 'rejected');
        if (failed) toast.error('The student was saved, but the ticks from the form were not. Enter them on the History tab.');
      }
      if (position) {
        toast.success(`Saved ${form.lastName}, ${form.firstName} (${position.index + 1} of ${position.total})`);
        onDone('saved');
        return;
      }
      toast.success(`Student added: ${form.lastName}, ${form.firstName} · ${schoolYearLabel()} record opened`);
      navigate(`/dental-chart/${created._id}?tab=history`);
    } catch (err) {
      const dupes = duplicatesFromError(err);
      if (dupes) { setDuplicates(dupes); return; }
      setError(err instanceof ApiError ? err.message : 'Failed to save student.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#F6F9FC', minHeight: '100%', padding: '2rem 3rem', fontFamily: 'var(--font-sans)', color: '#141413' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '3.25rem', height: '3.25rem', borderRadius: '0.875rem', background: '#F4F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="22.1" height="22.1" viewBox="0 0 24 24" fill="none" stroke="#273A78" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </div>
          <div>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#67687A' }}>
              Students &middot; OCR{position && <> &middot; Student {position.index + 1} of {position.total}</>}
            </div>
            <h1 style={{ margin: '0.125rem 0 0', fontSize: '1.5rem', fontWeight: 700 }}>Verify Extracted Information</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/students/scan')}
          style={{ cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5625rem 1rem', borderRadius: '0.625rem', fontSize: '0.8125rem', fontWeight: 600, color: '#141413', border: '0.0625rem solid #E2E8F0', background: '#fff' }}
        >
          <svg width="12.8" height="12.8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          Back
        </button>
      </div>

      {handoff.readError && (
        <div style={{ background: '#FFF7ED', border: '0.0625rem solid #FED7AA', borderRadius: '0.75rem', padding: '0.625rem 1rem', marginBottom: '1.125rem', fontSize: '0.78125rem', color: '#9A3412' }}>
          {handoff.sourceFileName}: {handoff.readError} Type the details below, or skip this form.
        </div>
      )}

      {duplicates && (
        <div style={{ background: '#FFF1F2', border: '0.0625rem solid rgba(190,18,60,0.2)', borderRadius: '0.75rem', padding: '0.625rem 1rem', marginBottom: '1.125rem', fontSize: '0.78125rem', color: '#BE123C' }}>
          <p style={{ margin: '0rem', fontWeight: 600 }}>Possible duplicate</p>
          <p style={{ margin: '0.125rem 0 0.5rem' }}>
            {duplicates[0].full_name} is already on file, born {duplicates[0].birthday} ({duplicates[0].grade_level} {duplicates[0].section}).
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" onClick={() => setDuplicates(null)} style={{ cursor: 'pointer', padding: '0.375rem 0.75rem', borderRadius: '62.4375rem', fontSize: '0.75rem', fontWeight: 600, border: '0.0625rem solid rgba(190,18,60,0.3)', background: '#fff', color: '#BE123C' }}>Let me edit</button>
            <button type="button" onClick={() => { setDuplicates(null); void save(true); }} style={{ cursor: 'pointer', padding: '0.375rem 0.75rem', borderRadius: '62.4375rem', fontSize: '0.75rem', fontWeight: 600, border: 'none', background: '#BE123C', color: '#fff' }}>Save anyway — different student</button>
          </div>
        </div>
      )}

      {/* Body: source + form */}
      <div style={{ display: 'grid', gridTemplateColumns: '18.75rem minmax(0, 1fr)', gap: '1.5rem' }}>
        {/* Source thumbnail */}
        <div style={{ background: '#fff', border: '0.0625rem solid #E2E8F0', borderRadius: '1rem', padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem', alignSelf: 'start' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#67687A' }}>Source</div>
          <div style={{ width: '100%', aspectRatio: '3/4', background: '#ECECF0', borderRadius: '0.625rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#98999f', overflow: 'hidden' }}>
            {handoff.sourcePreviewUrl ? (
              <img src={handoff.sourcePreviewUrl} alt="Source form" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="15.3" height="15.3" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            )}
          </div>
          <div style={{ fontSize: '0.78125rem', fontWeight: 600, wordBreak: 'break-word' }}>{handoff.sourceFileName}</div>
          {handoff.sourcePreviewUrl && (
            <button
              type="button"
              onClick={() => setShowSourcePreview(true)}
              style={{ fontSize: '0.78125rem', color: '#273A78', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              View full size &rarr;
            </button>
          )}
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label required extracted={isExtracted('lastName')}>Last Name</Label>
              <input style={inputStyle} value={form.lastName} onChange={(e) => update('lastName', e.target.value)} />
            </div>
            <div>
              <Label required extracted={isExtracted('firstName')}>First Name</Label>
              <input style={inputStyle} value={form.firstName} onChange={(e) => update('firstName', e.target.value)} />
            </div>
            <div>
              <Label extracted={isExtracted('middleName')}>Middle Name</Label>
              <input style={inputStyle} value={form.middleName} onChange={(e) => update('middleName', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label required extracted={isExtracted('birthdate')}>Birthdate</Label>
              <input type="date" style={inputStyle} value={form.birthdate} onChange={(e) => update('birthdate', e.target.value)} />
            </div>
            <div>
              <Label>Age <span style={{ fontSize: '0.59375rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#67687A', background: '#ECECF0', borderRadius: '62.4375rem', padding: '0.0625rem 0.4375rem' }}>Auto-calculated</span></Label>
              <input style={{ ...inputStyle, background: '#F6F9FC', color: '#67687A' }} value={age ?? ''} disabled />
            </div>
            <div>
              <Label required extracted={isExtracted('gender')}>Sex</Label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['Male', 'Female'].map((s) => {
                  const active = form.gender === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      onClick={() => update('gender', s)}
                      style={{ cursor: 'pointer', boxSizing: 'border-box', flex: 1, textAlign: 'center', padding: '0.5625rem 0', borderRadius: '0.625rem', fontSize: '0.8125rem', fontWeight: active ? 700 : 600, background: active ? '#F4F7FF' : '#fff', border: active ? '0.09375rem solid #273A78' : '0.09375rem solid #E2E8F0', color: active ? '#273A78' : '#67687A' }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label required extracted={isExtracted('grade')}>Grade</Label>
              <select style={{ ...inputStyle, appearance: 'auto' }} value={form.grade} onChange={(e) => update('grade', e.target.value)}>
                <option value="">Select Grade</option>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <Label required extracted={isExtracted('section')}>Section</Label>
              <input style={inputStyle} placeholder="Search or add a section" value={form.section} onChange={(e) => update('section', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label extracted={isExtracted('placeOfBirth')}><>Place of Birth <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="e.g. Taguig City" value={form.placeOfBirth} onChange={(e) => update('placeOfBirth', e.target.value)} />
            </div>
            <div>
              <Label extracted={isExtracted('contactNumber')}><>Contact Number <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="09XX-XXX-XXXX" value={form.contactNumber} onChange={(e) => update('contactNumber', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label extracted={isExtracted('guardianName')}><>Guardian Name <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="Full name" value={form.guardianName} onChange={(e) => update('guardianName', e.target.value)} />
            </div>
            <div>
              <Label extracted={isExtracted('guardianContact')}><>Guardian Contact <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="09XX-XXX-XXXX" value={form.guardianContact} onChange={(e) => update('guardianContact', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label extracted={isExtracted('guardianOccupation')}><>Occupation <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="Guardian's occupation" value={form.guardianOccupation} onChange={(e) => update('guardianOccupation', e.target.value)} />
            </div>
            <div>
              <Label extracted={isExtracted('philhealthNumber')}><>PhilHealth Number <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} placeholder="XX-XXXXXXXXX-X" value={form.philhealthNumber} onChange={(e) => update('philhealthNumber', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div>
              <Label extracted={isExtracted('philhealthStatus')}>PhilHealth Status</Label>
              <select style={{ ...inputStyle, appearance: 'auto' }} value={form.philhealthStatus} onChange={(e) => update('philhealthStatus', e.target.value)}>
                <option>None</option>
                <option>Principal</option>
                <option>Dependent</option>
              </select>
            </div>
            <div>
              <Label extracted={isExtracted('address')}><>Address <span style={{ color: '#98999f', fontWeight: 500 }}>(Optional)</span></></Label>
              <input style={inputStyle} value={form.address} onChange={(e) => update('address', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* The IPTR Year 1-5 tick grid (O2b). Shown for review, saved only
          when ticked here; absent for a spreadsheet upload. */}
      {handoff.ticks && (
        <div style={{ marginTop: '1.5rem', background: '#fff', border: '0.0625rem solid #E2E8F0', borderRadius: '1rem', padding: '1rem 1.125rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#67687A' }}>Ticks found on the form</div>
          {handoff.ticks.confidence === 0 ? (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#67687A' }}>
              No Year 1-5 tick table was read from this form ({handoff.ticks.reason ?? 'not found'}). If the form has one, enter its ticks on the History tab after saving.
            </p>
          ) : tickFindings.length === 0 ? (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#67687A' }}>No ticks were found on the Year 1-5 table.</p>
          ) : (
            <>
              <p style={{ margin: '0.375rem 0 0.75rem', fontSize: '0.78125rem', color: '#67687A' }}>
                Nothing here is saved unless you tick it. Ticked rows go into the {schoolYearLabel()} record.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78125rem', fontWeight: 600, color: '#33344a', marginBottom: '0.75rem' }}>
                This school year is the form&apos;s
                <select
                  style={{ ...inputStyle, width: 'auto', appearance: 'auto' }}
                  value={tickYear}
                  onChange={(e) => { setTickYear(Number(e.target.value)); setAcceptedTicks(new Set()); }}
                >
                  {[1, 2, 3, 4, 5].map((y) => {
                    const n = tickFindings.filter((f) => f.years.includes(y)).length;
                    return <option key={y} value={y}>Year {y}{n ? ` (${n} ticked)` : ''}</option>;
                  })}
                </select>
                column
              </label>
              {(['medical', 'dietary', 'oral'] as const).map((section) => {
                const rows = tickFindings.filter((f) => f.section === section && f.years.includes(tickYear));
                if (!rows.length) return null;
                return (
                  <div key={section} style={{ marginBottom: '0.625rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#141413', marginBottom: '0.25rem' }}>{SECTION_TITLES[section]}</div>
                    {rows.map((f) => {
                      const kind = tickKind(f);
                      if (kind !== 'storable') {
                        return (
                          <div key={tickKey(f)} style={{ fontSize: '0.78125rem', color: '#67687A', padding: '0.1875rem 0' }}>
                            {f.label}: {kind === 'text' ? 'ticked. Type the details on the History tab.' : 'ticked, but the system has no field for it, so it is not saved.'}
                          </div>
                        );
                      }
                      return (
                        <label key={tickKey(f)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', padding: '0.1875rem 0', cursor: 'pointer' }}>
                          <input type="checkbox" checked={acceptedTicks.has(tickKey(f))} onChange={() => toggleTick(tickKey(f))} />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
              {!tickFindings.some((f) => f.years.includes(tickYear)) && (
                <p style={{ margin: 0, fontSize: '0.78125rem', color: '#67687A' }}>No ticks in Year {tickYear}.</p>
              )}
            </>
          )}
        </div>
      )}

      {error && <p style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#BE123C' }}>{error}</p>}
      {missing.size > 0 && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#BE123C' }}>Highlighted fields above are required.</p>
      )}

      {/* Footer actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
        <button
          type="button"
          onClick={() => navigate('/students/scan')}
          style={{ cursor: 'pointer', boxSizing: 'border-box', padding: '0.6875rem 1.25rem', borderRadius: '0.625rem', fontSize: '0.875rem', fontWeight: 600, color: '#141413', border: '0.0625rem solid #E2E8F0', background: '#fff' }}
        >
          {position ? 'Stop batch' : 'Cancel'}
        </button>
        {position && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onDone('skipped')}
            style={{ cursor: saving ? 'not-allowed' : 'pointer', boxSizing: 'border-box', padding: '0.6875rem 1.25rem', borderRadius: '0.625rem', fontSize: '0.875rem', fontWeight: 600, color: '#141413', border: '0.0625rem solid #E2E8F0', background: '#fff' }}
          >
            Skip this form
          </button>
        )}
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saving}
          style={{ cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6875rem 1.375rem', borderRadius: '0.625rem', fontSize: '0.875rem', fontWeight: 700, background: '#273A78', color: '#fff', border: 'none' }}
        >
          <svg width="13.6" height="13.6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          {saving ? 'Saving…' : position && position.index + 1 < position.total ? 'Save & Next' : 'Confirm & Save Student'}
        </button>
      </div>

      <PreviewModal
        open={showSourcePreview}
        kind="image"
        title={handoff.sourceFileName}
        url={handoff.sourcePreviewUrl}
        onClose={() => setShowSourcePreview(false)}
        onDownload={() => {
          if (!handoff.sourcePreviewUrl) return;
          const a = document.createElement('a');
          a.href = handoff.sourcePreviewUrl;
          a.download = handoff.sourceFileName;
          a.click();
        }}
      />
    </div>
  );
};
