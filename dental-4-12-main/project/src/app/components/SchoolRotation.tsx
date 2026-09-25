import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MapPin, School as SchoolIcon } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { ApiDentistRotation, ApiSchool } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useSchools } from '../hooks/useSchools';
import { addDays, dayStart, mondayOf, useRotationDentist, useRotations } from '../hooks/useRotations';
import { toLocalDateString } from '../utils/localDate';
import { getSchoolAcronym, getSchoolColor, getSchoolShortName } from '../utils/schoolColors';
import { Modal } from './Modal';
import { useToast } from './Toast';

// ─── School Rotation (2026-09-24, user-approved design) ──────────────────────
// Where the dentist is each weekday. Built from the Dashboard's white stat
// cards ("Patients enrolled"): label top-left, icon tile top-right, a big
// value, a rule, a "›" footer line. School colours are the app's existing
// ones (utils/schoolColors). The reminder only ever speaks about TODAY and
// TOMORROW (user rule), in the top bar and on the Dashboard.

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (d: Date) => `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`;

/** The Dashboard stat-card shell, with the value optionally in a school colour. */
function RotationCard({ label, tag, icon, value, valueColor, footer, footerStrong, tone, outlined, onClick, compact }: {
  compact?: boolean; label: string; tag?: 'Today' | 'Tomorrow'; icon: React.ReactNode; value: React.ReactNode; valueColor?: string;
  footer: string; footerStrong?: boolean; tone?: { solid: string; light: string }; outlined?: boolean; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[13px] font-medium leading-snug text-muted-foreground">{label}</span>
          {tag && (
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${tag === 'Today' ? 'bg-primary text-white' : 'border border-primary text-primary'}`}>{tag}</span>
          )}
        </div>
        <span className={`flex shrink-0 items-center justify-center rounded-2xl ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
          style={{ backgroundColor: tone?.light ?? 'var(--primary-surface)', color: tone?.solid ?? 'var(--primary)' }}>
          {icon}
        </span>
      </div>
      {/* Long school names ("South Daanghari") step down in size rather
          than being cut off with an ellipsis. */}
      <div className={`mb-3 mt-3 font-extrabold leading-tight ${typeof value === 'string' && value.length > 8 ? (compact ? 'text-[17px]' : 'text-[21px]') : (compact ? 'text-[22px]' : 'text-[26px]')}`} style={{ color: valueColor }}>{value}</div>
      <div className="mt-auto flex items-start gap-2 border-t border-border pt-2.5 text-xs">
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2.5} />
        <span className={`min-w-0 break-words ${footerStrong ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{footer}</span>
      </div>
    </>
  );
  const cls = `flex h-full flex-col rounded-2xl border bg-card ${compact ? 'p-4' : 'p-5'} text-left shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 ${outlined ? 'border-primary ring-2 ring-primary' : 'border-border'}`;
  if (!onClick) return <div className={cls}>{body}</div>;
  return <button type="button" onClick={onClick} className={`${cls} w-full hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]`}>{body}</button>;
}

const schoolOf = (schools: ApiSchool[], id: string | undefined) => schools.find((s) => s._id === id) ?? null;

/** The Appointments page's School Rotation tab. */
export function SchoolRotationTab() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user?.role === 'dentist' || user?.role === 'dental_aide' || user?.role === 'system_admin';
  const { schools } = useSchools();
  const { dentist, dentists, isOwn, setChosenId } = useRotationDentist();

  const today = dayStart(new Date());
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const weekDays = useMemo(() => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)), [weekStart]);
  // One read covers everything on screen: the viewed week, the week before it
  // (Copy last week) and today/tomorrow.
  const from = [addDays(weekStart, -7), today].reduce((a, b) => (a < b ? a : b));
  const to = [addDays(weekStart, 6), addDays(today, 1)].reduce((a, b) => (a > b ? a : b));
  const { byDay, loading, reload } = useRotations(from, to, dentist?._id);

  const [editDay, setEditDay] = useState<Date | null>(null);
  const [pickSchool, setPickSchool] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rowFor = (d: Date) => byDay.get(toLocalDateString(d)) ?? null;
  const schoolFor = (d: Date) => schoolOf(schools, rowFor(d)?.school_id);

  const openDay = (d: Date) => {
    if (!canEdit) return;
    const r = rowFor(d);
    setEditDay(d); setPickSchool(r?.school_id ?? null); setNote(r?.notes ?? ''); setErr(null);
  };

  /** Writes one day. An existing row that is exactly this day is updated; a
   *  day covered by an older multi-day row gets its own single-day row. */
  const writeDay = async (d: Date, schoolId: string, notes: string) => {
    const r = rowFor(d);
    const iso = dayStart(d).toISOString();
    const single = r && toLocalDateString(new Date(r.week_start)) === toLocalDateString(d) && toLocalDateString(new Date(r.week_end)) === toLocalDateString(d);
    if (single) await apiClient.put(`/dentist-rotations/${r!._id}`, { school_id: schoolId, notes });
    else await apiClient.post('/dentist-rotations', { school_id: schoolId, dentist_id: dentist!._id, week_start: iso, week_end: iso, notes });
  };

  const saveDay = async () => {
    if (!editDay || !pickSchool || !dentist) { setErr('Pick a school.'); return; }
    setBusy(true); setErr(null);
    try {
      await writeDay(editDay, pickSchool, note.trim());
      await reload();
      setEditDay(null);
      toast.success(`${longDay(editDay)} set.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    } finally { setBusy(false); }
  };

  const clearDay = async () => {
    const r = editDay ? rowFor(editDay) : null;
    if (!r || !editDay) { setEditDay(null); return; }
    setBusy(true); setErr(null);
    try {
      // Archived, never deleted (CLAUDE.md). Only a row that is exactly this
      // day is cleared; an old weekly row is left for the admin to archive.
      const single = toLocalDateString(new Date(r.week_start)) === toLocalDateString(new Date(r.week_end));
      if (!single) { setErr('This day belongs to an older week-long entry. Pick a school instead to override it.'); setBusy(false); return; }
      await apiClient.patch(`/dentist-rotations/${r._id}/archive`);
      await reload();
      setEditDay(null);
      toast.success(`${longDay(editDay)} cleared.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not clear the day.');
    } finally { setBusy(false); }
  };

  // Copy last week: fills only the days of the viewed week that are NOT set,
  // from the same weekday a week earlier. Never overwrites a day already set.
  const copyLastWeek = async () => {
    if (!dentist) return;
    const todo = weekDays.filter((d) => !rowFor(d) && rowFor(addDays(d, -7)));
    if (!todo.length) { toast.success('Nothing to copy: every open day was also open last week.'); return; }
    setBusy(true);
    try {
      for (const d of todo) {
        const prev = rowFor(addDays(d, -7))!;
        await writeDay(d, prev.school_id, prev.notes ?? '');
      }
      await reload();
      toast.success(`Copied ${todo.length} day${todo.length === 1 ? '' : 's'} from last week.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not copy last week.');
    } finally { setBusy(false); }
  };

  const tomorrow = addDays(today, 1);
  const firstUnset = weekDays.find((d) => !rowFor(d)) ?? weekDays[0];
  const weekTitle = `${MONTH[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${weekDays[0].getMonth() === weekDays[4].getMonth() ? '' : `${MONTH[weekDays[4].getMonth()]} `}${weekDays[4].getDate()}, ${weekDays[4].getFullYear()}`;

  if (!dentist && !loading) {
    return <p className="text-sm text-muted-foreground">No dentist account is set up yet, so there is no rotation to show.</p>;
  }

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">School Rotation</h2>
          {dentists.length > 1 && !isOwn ? (
            <select value={dentist?._id ?? ''} onChange={(e) => setChosenId(e.target.value)}
              className="mt-1 rounded-lg border border-border bg-card px-2 py-1 text-xs">
              {dentists.map((d) => <option key={d._id} value={d._id}>Dr. {d.first_name} {d.last_name}</option>)}
            </select>
          ) : dentist && <p className="text-xs text-muted-foreground">Dr. {dentist.first_name} {dentist.last_name}</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2 sm:ml-auto">
            <button type="button" onClick={copyLastWeek} disabled={busy}
              className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-gray-50 disabled:opacity-60">Copy last week</button>
            <button type="button" onClick={() => openDay(firstUnset)} disabled={busy}
              className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60">Set a day</button>
          </div>
        )}
      </div>

      {/* Today up front (user's pick, 2026-09-25): today as a card filled with
          the school's colour, tomorrow beside it. An unset day is a dashed
          card that opens the picker. Nothing past tomorrow is shown here. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[{ d: today, name: 'Today' }, { d: tomorrow, name: 'Tomorrow' }].map(({ d, name }) => {
          const sch = schoolFor(d);
          const c = sch ? getSchoolColor(sch.school_name) : null;
          const big = name === 'Today';
          const label = `${name} · ${big ? longDay(d) : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}`;
          const inner = (
            <>
              <span className={`block text-[11px] font-semibold uppercase tracking-wide ${sch && big ? 'text-white/80' : 'text-muted-foreground'}`}>{label}</span>
              <span className={`mt-1 block font-extrabold leading-tight ${big ? 'text-[32px]' : 'text-[24px]'}`}
                style={{ color: sch ? (big ? '#fff' : c!.solid) : '#94a3b8' }}>{sch ? getSchoolAcronym(sch.school_name) : 'Not set'}</span>
              <span className={`mt-1 block text-xs ${sch ? (big ? 'text-white/85' : 'text-muted-foreground') : 'font-semibold text-primary'}`}>
                {sch ? sch.school_name : canEdit ? 'Set school ›' : 'No school set'}
              </span>
              {rowFor(d)?.notes && <span className={`mt-1 block text-xs italic ${big && sch ? 'text-white/85' : 'text-muted-foreground'}`}>{rowFor(d)!.notes}</span>}
              {big && sch && <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-white/10" />}
            </>
          );
          const cls = `relative flex flex-col justify-center overflow-hidden rounded-2xl p-5 text-left ${big ? 'md:col-span-2' : ''} ${
            sch ? '' : 'border border-dashed border-slate-300 bg-card'}`;
          const style = sch ? (big ? { backgroundColor: c!.solid } : { backgroundColor: c!.light }) : undefined;
          return canEdit
            ? <button key={name} type="button" onClick={() => openDay(d)} className={`${cls} transition-transform hover:-translate-y-0.5`} style={style}>{inner}</button>
            : <div key={name} className={cls} style={style}>{inner}</div>;
        })}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-sm font-bold text-foreground">Week of {weekTitle}</span>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
          {toLocalDateString(weekStart) !== toLocalDateString(mondayOf(new Date())) && (
            <button type="button" onClick={() => setWeekStart(mondayOf(new Date()))} className="text-xs font-semibold text-primary hover:underline">This week</button>
          )}
        </div>
        {/* Colour-topped day cards (user's pick, 2026-09-25): a solid band in
            the school's colour carries the day and date; the school, its full
            name and Change sit underneath. Grey band when the day is not set. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {weekDays.map((d) => {
            const key = toLocalDateString(d);
            const isToday = key === toLocalDateString(today);
            const sch = schoolFor(d);
            const c = sch ? getSchoolColor(sch.school_name) : null;
            const note = rowFor(d)?.notes;
            const inner = (
              <>
                <span className="flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: c?.solid ?? '#CBD5E1' }}>
                  <span>{WEEKDAY[d.getDay()]}{isToday ? ' · Today' : ''}</span>
                  <span className="normal-case">{MONTH[d.getMonth()]} {d.getDate()}</span>
                </span>
                <span className="block px-3 py-3">
                  <span className={`block font-extrabold leading-tight ${sch && getSchoolAcronym(sch.school_name).length > 8 ? 'text-[16px]' : 'text-[19px]'}`}
                    style={{ color: c?.solid ?? '#94a3b8' }}>{sch ? getSchoolAcronym(sch.school_name) : 'Not set'}</span>
                  {sch && <span className="mt-0.5 block text-[11px] text-muted-foreground">{getSchoolShortName(sch.school_name)}</span>}
                  {note && <span className="mt-1 block text-[11px] italic text-muted-foreground">{note}</span>}
                  {canEdit && <span className="mt-2.5 block text-xs font-semibold text-primary">{sch ? 'Change ›' : 'Set school ›'}</span>}
                </span>
              </>
            );
            const cls = `flex flex-col justify-start overflow-hidden rounded-2xl border bg-card text-left ${isToday ? 'border-primary ring-2 ring-primary' : 'border-border'}`;
            return canEdit
              ? <button key={key} type="button" onClick={() => openDay(d)} className={`${cls} transition-transform hover:-translate-y-0.5`}>{inner}</button>
              : <div key={key} className={cls}>{inner}</div>;
          })}
        </div>
      </div>

      {editDay && (
        <Modal onClose={() => setEditDay(null)} closeDisabled={busy} maxWidth="max-w-md">
          <div role="dialog" aria-label={`Set school for ${longDay(editDay)}`} className="p-5">
            <h3 className="text-base font-bold text-sidebar-bg">{longDay(editDay)}</h3>
            <p className="text-xs text-muted-foreground">Where will the dentist be?</p>
            <div className="mt-3 space-y-2">
              {schools.map((s) => {
                const c = getSchoolColor(s.school_name);
                const on = pickSchool === s._id;
                return (
                  <button key={s._id} type="button" onClick={() => setPickSchool(s._id)} aria-pressed={on}
                    className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors"
                    style={on ? { borderColor: c.solid, backgroundColor: c.light, boxShadow: `0 0 0 1px ${c.solid}` } : undefined}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ backgroundColor: on ? '#fff' : c.light, color: c.solid }}><SchoolIcon className="h-5 w-5" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-foreground">{getSchoolAcronym(s.school_name)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.school_name}</span>
                    </span>
                    {on && <Check className="ml-auto h-4 w-4 shrink-0" style={{ color: c.solid }} />}
                  </button>
                );
              })}
            </div>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200}
              placeholder="Note (optional), e.g. afternoon only"
              className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
            <div className="mt-4 flex items-center gap-2">
              {rowFor(editDay) && (
                <button type="button" onClick={clearDay} disabled={busy}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-destructive hover:bg-danger-surface disabled:opacity-60">Clear day</button>
              )}
              <button type="button" onClick={() => setEditDay(null)} disabled={busy}
                className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-foreground hover:bg-gray-50 disabled:opacity-60">Cancel</button>
              <button type="button" onClick={saveDay} disabled={busy || !pickSchool}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Today / tomorrow for the reminders. Only the dentist and the dental aide
 *  get one (user-approved); everyone else gets nothing. */
function useTodayTomorrow() {
  const { user } = useAuth();
  const eligible = user?.role === 'dentist' || user?.role === 'dental_aide';
  const { schools } = useSchools();
  const { dentist } = useRotationDentist(eligible);
  const today = dayStart(new Date());
  const tomorrow = addDays(today, 1);
  const { byDay } = useRotations(today, tomorrow, eligible ? dentist?._id : null);
  const at = (d: Date) => schoolOf(schools, byDay.get(toLocalDateString(d))?.school_id);
  return { eligible, today: at(today), tomorrow: at(tomorrow), todayDate: today, tomorrowDate: tomorrow };
}

/** Top-bar reminder: every page. Only days that ARE set are shown, and never
 *  anything past tomorrow. Tomorrow hides below `sm` so a phone keeps just today. */
export function RotationTopBar() {
  const { eligible, today, tomorrow } = useTodayTomorrow();
  if (!eligible || (!today && !tomorrow)) return null;
  const chip = (when: string, s: ApiSchool, extra = '') => {
    const c = getSchoolColor(s.school_name);
    return (
      <span className={`items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 ${extra}`} title={`${when}: ${s.school_name}`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: c.light, color: c.solid }}>
          <MapPin className="h-3.5 w-3.5" />
        </span>
        <span className="leading-tight">
          <span className="block text-[10px] text-muted-foreground">{when}</span>
          <span className="block text-xs font-semibold text-foreground">{getSchoolAcronym(s.school_name)}</span>
        </span>
      </span>
    );
  };
  return (
    <div className="flex items-center gap-2">
      {today && chip('Today', today, 'flex')}
      {tomorrow && chip('Tomorrow', tomorrow, 'hidden sm:flex')}
    </div>
  );
}

/** The same two cards at the top of the Dashboard (dentist and aide only). */
export function RotationDashboardCards() {
  const { eligible, today, tomorrow, todayDate, tomorrowDate } = useTodayTomorrow();
  if (!eligible || (!today && !tomorrow)) return null;
  const card = (label: string, s: ApiSchool | null) => {
    const c = s ? getSchoolColor(s.school_name) : undefined;
    return (
      <RotationCard label={label} icon={<MapPin className="h-5 w-5" />} tone={c}
        value={s ? getSchoolAcronym(s.school_name) : 'Not set'} valueColor={c?.solid ?? '#94a3b8'}
        footer={s ? s.school_name : 'Set it under Appointments, School Rotation'} />
    );
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {card(`Today · ${WEEKDAY[todayDate.getDay()]}`, today)}
      {card(`Tomorrow · ${WEEKDAY[tomorrowDate.getDay()]}`, tomorrow)}
    </div>
  );
}

export type { ApiDentistRotation };
