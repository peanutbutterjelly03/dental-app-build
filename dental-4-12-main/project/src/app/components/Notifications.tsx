import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import {
  AlertTriangle, Bell, Calendar, Brain, StickyNote, ClipboardCheck, Clock,
  MoreHorizontal, CheckCircle2, Circle, Trash2, ArrowRight, MapPin, FileText,
  ListChecks, ChevronDown, Users, School as SchoolIcon, Archive, UserCog, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications, NOTIFIED_ROLES } from '../hooks/useNotifications';
import { useRotationDentist, useRotations, dayStart, addDays } from '../hooks/useRotations';
import { useSchools } from '../hooks/useSchools';
import { toLocalDateString } from '../utils/localDate';
import { getQueuedStudentIds } from '../utils/queueStorage';
import { PageHeader } from './PageHeader';

// ─── Notifications page ──────────────────────────────────────────────────────
// One flat feed, grouped Today / Earlier (approved design: "variant 1", a
// Facebook-style notification list). Unread rows carry a soft tint and bold
// text; each row's icon circle carries a small corner badge naming its kind.
// Per-row actions live behind a three-dot menu: Mark as read/unread (toggle)
// and Delete this notification -- both client-side only (localStorage), since
// there is no server model for "read" or "dismissed" and these are reminders
// to look at something, not records that need to survive across devices.
// Stored ids are pruned against the live payload each load, so a row that no
// longer exists (the RPC visit was recorded, the appointment was marked) can
// never leave a stale entry behind forever.
export const Notifications = () => {
  const { user, selectedSchool } = useAuth();
  const enabled = NOTIFIED_ROLES.includes(user?.role ?? '');
  const { counts, loading, error } = useNotifications(enabled, selectedSchool);
  const canValidateRisk = user?.role === 'dentist';
  // System Admin gets its own alerts (accounts, schools, student data, archive) and none of the clinical ones.
  const isAdmin = user?.role === 'system_admin';

  // School Rotation and the Treatment/Charting Queue have no server aggregate
  // of their own -- Rotation is small enough to read the same client hooks
  // the Rotation screen itself uses, and the queue is client-only state
  // (localStorage, see utils/queueStorage) that never touches the server at
  // all. Both are read directly here rather than added to
  // /stats/notifications, which stays about what the DB can aggregate.
  const { dentist } = useRotationDentist(enabled);
  const todayDate = useMemo(() => dayStart(new Date()), []);
  const tomorrowDate = useMemo(() => addDays(todayDate, 1), [todayDate]);
  const { byDay: rotationByDay } = useRotations(todayDate, tomorrowDate, dentist?._id);
  const { schools } = useSchools();
  const schoolNameById = (id: string) => schools.find((s) => s._id === id)?.school_name ?? '';
  const [queuedCount] = useState(() => getQueuedStudentIds().length);

  const loadIds = (key: string): Set<string> => {
    try {
      const raw = localStorage.getItem(key);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  };
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIds('floral.notifications.read'));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadIds('floral.notifications.dismissed'));
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);
  // Screen coordinates the popup portal renders at (see below) -- captured
  // from the clicked row's own bounding box, since the portal renders into
  // document.body and can no longer rely on CSS `absolute` positioning
  // against an ancestor.
  const [popupAnchor, setPopupAnchor] = useState<{ top: number; left: number } | null>(null);
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [readFilterOpen, setReadFilterOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const readFilterRef = useRef<HTMLDivElement | null>(null);

  const saveToStorage = (key: string, set: Set<string>) => {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage unavailable */ }
  };
  // Functional setState (reads the LATEST state directly, not a value
  // closed over from the render that created this handler) -- markRead is
  // called from the row's own "Go to" link, the popup's "Go to" button, and
  // the prune effect all touch the same key, so a stale closure could in
  // theory read an out-of-date Set and silently drop another change made in
  // the same tick. This guarantees a single click always sticks permanently
  // (user, 2026-09-29: "just need one click and it should stay read").
  const toggleRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveToStorage('floral.notifications.read', next);
      return next;
    });
    setOpenMenuId(null);
  };
  const markRead = (id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      saveToStorage('floral.notifications.read', next);
      return next;
    });
  };
  const dismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      saveToStorage('floral.notifications.dismissed', next);
      return next;
    });
    setOpenMenuId(null);
  };

  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

  useEffect(() => {
    if (!readFilterOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (readFilterRef.current && !readFilterRef.current.contains(e.target as Node)) setReadFilterOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [readFilterOpen]);

  // Clicking the row itself (not the three-dot or the "Go to" link, which
  // stop their own click from bubbling here) opens a small popover -- the
  // notification's own icon/category, its text, and the same two choices
  // the three-dot menu offers (approved design: "variant J", user,
  // 2026-09-29). It is a second, faster path to the same two actions, not a
  // replacement for the three-dot menu.
  //
  // ⚠ Rendered through a portal into document.body (below), not as a plain
  // descendant of the row (user, 2026-09-29, screenshot showing the popup's
  // bottom half cut off): the feed card needs `overflow-hidden` for its own
  // rounded corners, which was clipping the popup along with it whenever a
  // row sat near the card's edge. A portal escapes that ancestor entirely.
  // Since it's no longer positioned via CSS against the row, a scroll or
  // resize (which would leave it floating over the wrong row) just closes
  // it instead of trying to track the row's new position.
  useEffect(() => {
    if (!openPopupId) return;
    const close = () => { setOpenPopupId(null); setPopupAnchor(null); };
    const onDocClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openPopupId]);

  type Row = {
    id: string;
    group: 'today' | 'earlier';
    tier: 'needs-action' | 'today-tomorrow' | 'awaiting-review' | 'recent-activity';
    Icon: typeof Calendar;
    Badge: typeof Calendar;
    iconBg: string;
    iconFg: string;
    badgeBg: string;
    textBefore: string;
    textBold: string;
    textAfter: string;
    timeLabel: string;
    linkTo: string;
    linkLabel: string;
    /** When the event really happened (ms); used as the first-seen time. */
    at?: number;
  };

  // Compact relative age: 1m/1h/1d/1w (user, 2026-09-29: "if the
  // notification enters in just 1 minute, 1 hr, 1d, 1w, it should be like
  // that"), floored at 1m rather than a separate "Just now" case, and
  // capped at weeks -- nothing here is expected to sit unread for months.
  const relTime = (d: Date): string => {
    const diffMin = Math.max(1, Math.floor((Date.now() - d.getTime()) / 60000));
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d`;
    const diffW = Math.floor(diffD / 7);
    return `${diffW}w`;
  };

  const loadFirstSeen = (): Record<string, number> => {
    try {
      const raw = localStorage.getItem('floral.notifications.firstSeen');
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  };
  const saveFirstSeen = (map: Record<string, number>) => {
    try { localStorage.setItem('floral.notifications.firstSeen', JSON.stringify(map)); } catch { /* storage unavailable */ }
  };

  // Every row's timestamp is when it FIRST appeared in this browser's feed,
  // not the due date of the thing it's about (user, 2026-09-29: "the date
  // stamp should be by the time the notification enters the notification,
  // not when it's due"). An aggregate row (overdue RPC, risk validation,
  // consent, the queue) has no due date of its own to begin with -- it's
  // recomputed fresh on every load, so as long as the underlying condition
  // still holds it keeps its ORIGINAL first-seen stamp and just ages
  // (1h, 1d, 1w...) instead of being reset to "Today" every single day,
  // while still showing up every day the condition persists.
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];

    if (isAdmin) {
      const KIND_ICON = { students: Users, school: SchoolIcon, archive: Archive, account: UserCog, security: ShieldAlert, housekeeping: SchoolIcon } as const;
      const TIER_STYLE = {
        'needs-action': { iconBg: 'bg-danger-surface', iconFg: 'text-destructive', badgeBg: 'bg-destructive', Badge: AlertTriangle },
        'recent-activity': { iconBg: 'bg-primary-surface', iconFg: 'text-primary', badgeBg: 'bg-primary', Badge: Clock },
        'awaiting-review': { iconBg: 'bg-warning-surface', iconFg: 'text-warning', badgeBg: 'bg-warning', Badge: Clock },
      } as const;
      for (const a of counts.admin?.items ?? []) {
        const st = TIER_STYLE[a.tier];
        list.push({
          id: a.id,
          group: a.at && Date.now() - new Date(a.at).getTime() > 24 * 60 * 60 * 1000 ? 'earlier' : 'today',
          tier: a.tier,
          Icon: KIND_ICON[a.kind],
          Badge: st.Badge,
          iconBg: st.iconBg,
          iconFg: st.iconFg,
          badgeBg: st.badgeBg,
          textBefore: a.before,
          textBold: a.bold,
          textAfter: a.after,
          timeLabel: '',
          linkTo: a.linkTo,
          linkLabel: a.linkLabel,
          at: a.at ? new Date(a.at).getTime() : undefined,
        });
      }
    }

    if (!isAdmin) for (const a of counts.unmarkedAppointments) {
      const dt = new Date(a.datetime);
      list.push({
        id: `appt-missed-${a.id}`,
        group: 'earlier',
        tier: 'needs-action',
        Icon: Calendar,
        Badge: AlertTriangle,
        iconBg: 'bg-danger-surface',
        iconFg: 'text-destructive',
        badgeBg: 'bg-destructive',
        textBefore: 'You have a missed appointment with ',
        textBold: a.studentName,
        textAfter: `. It was scheduled for ${dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}, but the visit was never marked as done.`,
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (counts.overdueRpc > 0) {
      list.push({
        id: 'rpc-overdue',
        group: 'today',
        tier: 'needs-action',
        Icon: ClipboardCheck,
        Badge: Clock,
        iconBg: 'bg-danger-surface',
        iconFg: 'text-destructive',
        badgeBg: 'bg-destructive',
        textBefore: 'You have ',
        textBold: `${counts.overdueRpc} overdue RPC visit${counts.overdueRpc === 1 ? '' : 's'}`,
        textAfter: '. Visit 1 was recorded, but Visit 2 is still due and has already passed the interval between visits.',
        timeLabel: '',
        linkTo: '/rpc',
        linkLabel: 'Go to RPC Monitoring',
      });
    }
    if (counts.appointmentsToday > 0) {
      list.push({
        id: 'appt-today',
        group: 'today',
        tier: 'today-tomorrow',
        Icon: Calendar,
        Badge: Clock,
        iconBg: 'bg-primary-surface',
        iconFg: 'text-primary',
        badgeBg: 'bg-primary',
        textBefore: 'You have ',
        textBold: `${counts.appointmentsToday} appointment${counts.appointmentsToday === 1 ? '' : 's'} today`,
        textAfter: '. They are scheduled for today, across the school currently in view.',
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (counts.appointmentsTomorrow > 0) {
      list.push({
        id: 'appt-tomorrow',
        group: 'today',
        tier: 'today-tomorrow',
        Icon: Calendar,
        Badge: Clock,
        iconBg: 'bg-primary-surface',
        iconFg: 'text-primary',
        badgeBg: 'bg-primary',
        textBefore: 'You have ',
        textBold: `${counts.appointmentsTomorrow} appointment${counts.appointmentsTomorrow === 1 ? '' : 's'} tomorrow`,
        textAfter: '. They are scheduled for tomorrow, across the school currently in view.',
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (counts.dayNoteToday) {
      list.push({
        id: 'day-note-today',
        group: 'today',
        tier: 'today-tomorrow',
        Icon: StickyNote,
        Badge: Clock,
        iconBg: 'bg-warning-surface',
        iconFg: 'text-warning',
        badgeBg: 'bg-warning',
        textBefore: 'You have a note for today',
        textBold: '',
        textAfter: `, left for the clinic to see: ${counts.dayNoteToday}`,
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (canValidateRisk && counts.awaitingValidation > 0) {
      list.push({
        id: 'risk-awaiting',
        group: 'today',
        tier: 'awaiting-review',
        Icon: Brain,
        Badge: Clock,
        iconBg: 'bg-warning-surface',
        iconFg: 'text-warning',
        badgeBg: 'bg-warning',
        textBefore: 'You have ',
        textBold: `${counts.awaitingValidation} risk assessment${counts.awaitingValidation === 1 ? '' : 's'}`,
        textAfter: ' awaiting validation. These were predicted by the system and still need to be reviewed by the dentist.',
        timeLabel: '',
        linkTo: '/ai-analytics?tab=needs_review',
        linkLabel: 'Go to Risk Classification',
      });
    }
    if (counts.consentPending > 0) {
      list.push({
        id: 'consent-pending',
        group: 'today',
        tier: 'awaiting-review',
        Icon: ClipboardCheck,
        Badge: CheckCircle2,
        iconBg: 'bg-warning-surface',
        iconFg: 'text-warning',
        badgeBg: 'bg-warning',
        textBefore: 'You have ',
        textBold: `${counts.consentPending} student${counts.consentPending === 1 ? '' : 's'}`,
        textAfter: ' with consent pending. Their latest IPTR form still needs a consent decision recorded.',
        timeLabel: '',
        linkTo: '/patients',
        linkLabel: 'Go to Students',
      });
    }
    const todayKey = toLocalDateString(todayDate);
    const tomorrowKey = toLocalDateString(tomorrowDate);
    const rotToday = rotationByDay.get(todayKey);
    const rotTomorrow = rotationByDay.get(tomorrowKey);
    if (!isAdmin && rotToday) {
      list.push({
        id: 'rotation-today',
        group: 'today',
        tier: 'today-tomorrow',
        Icon: MapPin,
        Badge: Clock,
        iconBg: 'bg-primary-surface',
        iconFg: 'text-primary',
        badgeBg: 'bg-primary',
        textBefore: 'You are rotating to ',
        textBold: schoolNameById(rotToday.school_id),
        textAfter: ' today, per the current rotation schedule.',
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (!isAdmin && rotTomorrow) {
      list.push({
        id: 'rotation-tomorrow',
        group: 'today',
        tier: 'today-tomorrow',
        Icon: MapPin,
        Badge: Clock,
        iconBg: 'bg-primary-surface',
        iconFg: 'text-primary',
        badgeBg: 'bg-primary',
        textBefore: 'You are rotating to ',
        textBold: schoolNameById(rotTomorrow.school_id),
        textAfter: ' tomorrow, per the current rotation schedule.',
        timeLabel: '',
        linkTo: '/appointments',
        linkLabel: 'Go to Appointments',
      });
    }
    if (!isAdmin && queuedCount > 0) {
      list.push({
        id: 'queue-count',
        group: 'today',
        tier: 'needs-action',
        Icon: ListChecks,
        Badge: Clock,
        iconBg: 'bg-danger-surface',
        iconFg: 'text-destructive',
        badgeBg: 'bg-destructive',
        textBefore: 'You have ',
        textBold: `${queuedCount} student${queuedCount === 1 ? '' : 's'} queued`,
        textAfter: ' for charting or treatment in the Dental Charts module.',
        timeLabel: '',
        linkTo: '/dental-charts',
        linkLabel: 'Go to Dental Charts',
      });
    }
    // Calendar reminder, not a data-backed count -- there is no server
    // record of whether this month's report was generated (CLAUDE.md:
    // nothing fabricated), so this names only what IS real: the date. The id
    // carries the year/month, so it naturally reads as a new notification
    // each month instead of staying permanently "read".
    const now = new Date();
    if (!isAdmin && now.getDate() <= 5) {
      list.push({
        id: `reports-reminder-${now.getFullYear()}-${now.getMonth()}`,
        group: 'today',
        tier: 'today-tomorrow',
        Icon: FileText,
        Badge: Clock,
        iconBg: 'bg-primary-surface',
        iconFg: 'text-primary',
        badgeBg: 'bg-primary',
        textBefore: '',
        textBold: 'A new month has started',
        textAfter: '. This is a good time to generate the School Oral Health Status Report and the Consolidated Report for the City Health Office.',
        timeLabel: '',
        linkTo: '/reports',
        linkLabel: 'Go to Reports',
      });
    }
    const filtered = list.filter((r) => !dismissedIds.has(r.id));

    // Record each row's first-appearance time once, then stamp every row
    // with its age since then -- an id already in the map (still live
    // today, e.g. 'rpc-overdue') keeps its original moment; a genuinely new
    // one (a fresh missed appointment, or this same id reappearing after
    // being pruned once it disappeared) is stamped as of right now.
    const firstSeen = loadFirstSeen();
    const nowMs = Date.now();
    let firstSeenChanged = false;
    for (const r of filtered) {
      if (firstSeen[r.id] == null) { firstSeen[r.id] = r.at ?? nowMs; firstSeenChanged = true; }
    }
    if (firstSeenChanged) saveFirstSeen(firstSeen);
    for (const r of filtered) r.timeLabel = relTime(new Date(firstSeen[r.id]));

    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, canValidateRisk, isAdmin, dismissedIds, rotationByDay, todayDate, tomorrowDate, schools, queuedCount]);

  // Prune stale read/dismissed ids: a row that no longer exists (the RPC
  // visit was recorded, the appointment was marked) never leaves a
  // permanent entry taking up storage.
  useEffect(() => {
    if (loading) return;
    const liveIds = new Set(rows.map((r) => r.id));
    const prunedRead = new Set([...readIds].filter((id) => liveIds.has(id)));
    if (prunedRead.size !== readIds.size) { saveToStorage('floral.notifications.read', prunedRead); setReadIds(prunedRead); }
    const prunedDismissed = new Set([...dismissedIds].filter((id) => liveIds.has(id)));
    if (prunedDismissed.size !== dismissedIds.size) { saveToStorage('floral.notifications.dismissed', prunedDismissed); setDismissedIds(prunedDismissed); }
    // First-seen entries too, so an id that reappears later (the RPC visit
    // becomes overdue again after being resolved) is genuinely "new" again
    // instead of inheriting a stamp from months ago.
    const firstSeen = loadFirstSeen();
    let firstSeenPruned = false;
    for (const id of Object.keys(firstSeen)) {
      if (!liveIds.has(id)) { delete firstSeen[id]; firstSeenPruned = true; }
    }
    if (firstSeenPruned) saveFirstSeen(firstSeen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);

  if (!enabled) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Bell}
          eyebrow="Alerts"
          title="Notifications"
          description="Notifications aren't shown for this role. School Administrator and Barangay Health Office staff view reports, not clinical records."
        />
      </div>
    );
  }

  const TIERS = (isAdmin
    ? [
        { key: 'needs-action', label: 'Needs Action', tone: 'text-destructive' },
        { key: 'recent-activity', label: 'Recent Activity', tone: 'text-primary' },
        { key: 'awaiting-review', label: 'Awaiting Review', tone: 'text-yellow-600' },
      ]
    : [
        { key: 'needs-action', label: 'Needs Action', tone: 'text-destructive' },
        { key: 'today-tomorrow', label: 'Today & Tomorrow', tone: 'text-primary' },
        { key: 'awaiting-review', label: 'Awaiting Review', tone: 'text-yellow-600' },
      ]) as readonly { key: Row['tier']; label: string; tone: string }[];
  const tierCount = (key: string) => rows.filter((r) => r.tier === key).length;

  const visibleRows = (activeTier ? rows.filter((r) => r.tier === activeTier) : rows)
    .filter((r) => readFilter === 'all' || (readFilter === 'unread' ? !readIds.has(r.id) : readIds.has(r.id)));
  const todayRows = visibleRows.filter((r) => r.group === 'today');
  const earlierRows = visibleRows.filter((r) => r.group === 'earlier');

  const renderRow = (r: Row) => {
    const isRead = readIds.has(r.id);
    // Three real grid columns, not one flex row with a uniform gap (user,
    // 2026-09-29: "you put space with the icon... when you are supposed to
    // make space between the text and the icons in the right"): icon + text
    // stay close together (their own tight gap-3) in column 1, column 2 is
    // nothing but empty space (0.35fr against content's 3fr, narrowed
    // several times from the original 1fr -- user, 2026-09-29, "smaller
    // alloted space" most recently), and column 3 (three-dot + "Go to")
    // sits flush at the true right edge as its own group. `items-center`
    // (not `items-start`) on the row itself, so a one-line row centers its
    // text vertically against the icon and action column instead of sitting at
    // the top with dead space below it.
    const tier = TIERS.find((t) => t.key === r.tier)!;
    return (
      <li
        key={r.id}
        onClick={(e) => {
          if (openPopupId === r.id) {
            setOpenPopupId(null);
            setPopupAnchor(null);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const popupWidth = 384; // w-96
            setPopupAnchor({
              top: rect.bottom + 8,
              left: Math.min(rect.left + 16, window.innerWidth - popupWidth - 16),
            });
            setOpenPopupId(r.id);
          }
          setOpenMenuId(null);
        }}
        className={`relative grid grid-cols-[3fr_0.35fr_auto] items-center gap-0 p-3.5 cursor-pointer hover:bg-muted/40 ${isRead ? '' : 'bg-[#EEF3FF]'}`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative shrink-0">
            <span className={`flex h-11 w-11 items-center justify-center rounded-full ${r.iconBg}`}>
              <r.Icon className={`w-5 h-5 ${r.iconFg}`} />
            </span>
            <span className={`absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card ${r.badgeBg}`}>
              <r.Badge className="w-2.5 h-2.5 text-white" />
            </span>
          </div>

          {/* Only the bolded word/name is bold -- the surrounding sentence
              stays regular weight whether read or unread (user, 2026-09-29:
              "only the important words"); unread is carried by the row's
              tint alone. */}
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-snug text-foreground">
              {r.textBefore}<b className="font-bold">{r.textBold}</b>{r.textAfter}
              {' '}
              <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">{r.timeLabel}</span>
            </p>
          </div>
        </div>

        {/* Column 2: deliberately empty -- the spacer itself. */}
        <div aria-hidden="true" />

        {/* "Go to [module]" sits UNDER the three-dot button -- its own
            always-visible link in this column, not a selectable item inside
            the dropdown (user, 2026-09-29, correcting the previous round:
            "under the 3 dot, not become an option in the 3 dot"). */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="relative" ref={openMenuId === r.id ? menuRef : undefined} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => { setOpenMenuId(openMenuId === r.id ? null : r.id); setOpenPopupId(null); }}
              aria-label="Notification options"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {openMenuId === r.id && (
              <div className="absolute right-0 top-8 z-20 w-max overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                <button
                  type="button"
                  onClick={() => toggleRead(r.id)}
                  className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  {isRead ? <Circle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
                  Mark as {isRead ? 'unread' : 'read'}
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(r.id)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm whitespace-nowrap text-destructive hover:bg-danger-surface"
                >
                  <Trash2 className="w-4 h-4 flex-shrink-0" />
                  Delete this notification
                </button>
              </div>
            )}
          </div>
          <Link
            to={r.linkTo}
            onClick={(e) => { e.stopPropagation(); markRead(r.id); }}
            className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
          >
            <ArrowRight className="w-3 h-3" /> {r.linkLabel}
          </Link>
        </div>

        {openPopupId === r.id && popupAnchor && createPortal(
          <div
            ref={popupRef}
            onClick={(e) => e.stopPropagation()}
            style={{ top: popupAnchor.top, left: popupAnchor.left }}
            className="fixed z-50 w-96 rounded-2xl border border-border bg-card p-4 shadow-lg"
          >
            <div className="mb-2.5 flex items-center gap-2.5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${r.iconBg}`}>
                <r.Icon className={`w-4 h-4 ${r.iconFg}`} />
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${tier.tone}`}>{tier.label}</span>
            </div>
            <p className="mb-3.5 text-[12.5px] leading-snug text-foreground">
              {r.textBefore}<b className="font-bold">{r.textBold}</b>{r.textAfter}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { toggleRead(r.id); setOpenPopupId(null); setPopupAnchor(null); }}
                className="flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 py-2 text-[12.5px] font-semibold text-foreground hover:bg-muted"
              >
                {isRead ? <Circle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Mark {isRead ? 'unread' : 'read'}
              </button>
              <Link
                to={r.linkTo}
                onClick={() => { markRead(r.id); setOpenPopupId(null); setPopupAnchor(null); }}
                className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-2.5 py-2 text-[12.5px] font-semibold text-white hover:bg-primary/90"
              >
                {r.linkLabel}
              </Link>
            </div>
          </div>,
          document.body,
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bell}
        eyebrow="Alerts"
        title="Notifications"
        description={isAdmin ? "Account, school and record changes that need your attention as System Administrator." : "Reminders and follow-ups that need your attention, gathered from across the app."}
        action={
          !loading && !error && rows.length > 0 ? (
            <div className="relative shrink-0 mt-9" ref={readFilterRef}>
              <button
                type="button"
                onClick={() => setReadFilterOpen((v) => !v)}
                aria-expanded={readFilterOpen}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
              >
                {readFilter === 'all' ? 'All' : readFilter === 'unread' ? 'Unread' : 'Read'}
                <ChevronDown className={`w-4 h-4 transition-transform ${readFilterOpen ? 'rotate-180' : ''}`} />
              </button>
              {readFilterOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                  {(['all', 'unread', 'read'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => { setReadFilter(f); setReadFilterOpen(false); }}
                      className={`block w-full px-3.5 py-2 text-left text-sm font-medium capitalize hover:bg-muted ${
                        readFilter === f ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      {error && (
        <div className="flex items-center gap-2 bg-danger-surface text-destructive text-sm rounded-xl border border-destructive/20 p-4">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Counts unavailable right now.
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 bg-card rounded-xl border border-border p-12 text-center">
          <Bell className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {/* Compact tier summary -- sized to its own content (`self-start`,
              no shared height with the feed beside it), not the stretched
              full-height panel an earlier round tried (user, 2026-09-29:
              "i didnt say copy the size of the container as well"). Click a
              tier to filter the feed; click it again to clear. */}
          <div className="w-full sm:w-56 shrink-0 self-start bg-card rounded-2xl border border-border shadow-sm p-3 space-y-1">
            {/* "All" clears the tier filter -- first in the list (user,
                2026-09-29, correcting an earlier "last" placement), black
                label, same red-circle count style as every tier below it. */}
            <button
              type="button"
              onClick={() => setActiveTier(null)}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                activeTier === null ? 'bg-muted' : 'hover:bg-muted/60'
              }`}
            >
              <span className="text-sm font-bold text-foreground">All</span>
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white tabular-nums">{rows.length}</span>
            </button>
            {TIERS.map((t) => {
              const n = tierCount(t.key);
              if (n === 0) return null;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActiveTier(activeTier === t.key ? null : t.key)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                    activeTier === t.key ? 'bg-muted' : 'hover:bg-muted/60'
                  }`}
                >
                  <span className={`text-sm font-bold ${t.tone}`}>{t.label}</span>
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>

          {/* Feed -- wider than the earlier `max-w-2xl` version (user,
              2026-09-29: "make the notifications container wider"); fills
              whatever space the tier panel beside it doesn't take. */}
          <div className="flex-1 min-w-0">
            <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              {todayRows.length > 0 && (
                <>
                  <div className="px-4 py-2.5 text-sm font-bold text-foreground bg-card border-b border-border">Today</div>
                  <ul className="divide-y divide-border">{todayRows.map(renderRow)}</ul>
                </>
              )}
              {earlierRows.length > 0 && (
                <>
                  <div className="px-4 py-2.5 text-sm font-bold text-foreground bg-card border-b border-border">Earlier</div>
                  <ul className="divide-y divide-border">{earlierRows.map(renderRow)}</ul>
                </>
              )}
              {todayRows.length === 0 && earlierRows.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {readFilter === 'unread' ? 'Nothing unread.' : readFilter === 'read' ? 'Nothing read yet.' : 'Nothing in this tier.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
