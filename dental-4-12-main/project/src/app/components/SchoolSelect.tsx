import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, ALL_SCHOOLS } from '../context/AuthContext';
import { getSchoolColor } from '../utils/schoolColors';
import { School, ChevronRight, ChevronDown, Check, LogOut, MapPin, Layers, Search, SearchX, ArrowUpDown, GripVertical } from 'lucide-react';
import { useSchools } from '../hooks/useSchools';
import { SCHOOL_GRADES, schoolGradeRange } from '../utils/schoolGrades';
import type { ApiSchool } from '../api/types';

const roleLabels: Record<string, string> = {
  dentist: 'Dentist',
  dental_aide: 'Dental Aide',
  school_admin: 'School Admin',
  bho_staff: 'Barangay Health Office Staff',
  system_admin: 'System Admin',
};

const roleBadgeColors: Record<string, string> = {
  dentist: 'bg-blue-100 text-blue-800',
  dental_aide: 'bg-teal-100 text-teal-800',
  school_admin: 'bg-orange-100 text-orange-800',
  bho_staff: 'bg-purple-100 text-purple-800',
  system_admin: 'bg-red-100 text-red-800',
};

// ─── Search, filters and recent schools: SYSTEM ADMIN ONLY ───────────────────
// A System Admin can hold every school, and the list is expected to grow past
// thirty. Every other role has a short, assigned list, so they get the same
// page with none of this.

type LevelFilter = 'all' | 'elementary' | 'integrated' | 'high';
type SortMode = 'mine' | 'az' | 'za' | 'newest';

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'mine', label: 'My order' },
  { key: 'az', label: 'A to Z' },
  { key: 'za', label: 'Z to A' },
  { key: 'newest', label: 'Newest first' },
];

/** Pill-shaped sort menu. A custom list rather than a native <select>, so the
 *  pill hugs the selected text while the open list is as wide as its longest
 *  option. Closes on outside click or Escape. */
const SortMenu = ({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = SORT_OPTIONS.find((o) => o.key === value) ?? SORT_OPTIONS[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Sort schools"
        className="inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-semibold text-[#475569] hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#16214F]/30"
      >
        {current.label}
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 top-full z-20 mt-2 min-w-[11rem] overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white py-1.5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
          {SORT_OPTIONS.map((o) => (
            <li key={o.key} role="option" aria-selected={o.key === value}>
              <button
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-[13px] font-semibold hover:bg-gray-50 ${o.key === value ? 'text-[#16214F]' : 'text-[#475569]'}`}
              >
                {o.label}
                {o.key === value && <Check className="w-4 h-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LEVEL_CHIPS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'elementary', label: 'Elementary' },
  { key: 'integrated', label: 'Integrated' },
  { key: 'high', label: 'High school' },
];

/** Elementary stops at Grade 6 or earlier, High school starts at Grade 7 or
 *  later, Integrated spans both. A school with no known range is null and only
 *  appears under "All". */
const levelOf = (s: ApiSchool | undefined): LevelFilter | null => {
  if (!s) return null;
  const { from, to } = schoolGradeRange(s);
  const f = SCHOOL_GRADES.indexOf(from);
  const t = SCHOOL_GRADES.indexOf(to);
  if (f < 0 || t < 0) return null;
  if (f >= 7) return 'high';
  if (t <= 6) return 'elementary';
  return 'integrated';
};

interface Recent { school: string; at: number }
const MAX_RECENT = 3;
const recentKey = (userId: string) => `floral.recentSchools.${userId}`;

const loadRecent = (userId: string): Recent[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((r): r is Recent => typeof r?.school === 'string' && typeof r?.at === 'number')
      : [];
  } catch {
    return [];
  }
};

const saveRecent = (userId: string, school: string) => {
  try {
    const next = [{ school, at: Date.now() }, ...loadRecent(userId).filter((r) => r.school !== school)].slice(0, MAX_RECENT);
    localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    /* private window or blocked storage: the picker still works without it */
  }
};

// The order a user arranged their schools in, kept in this browser per account.
const orderKey = (userId: string) => `floral.schoolOrder.${userId}`;

const loadOrder = (userId: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(orderKey(userId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
};

const saveOrder = (userId: string, order: string[]) => {
  try {
    localStorage.setItem(orderKey(userId), JSON.stringify(order));
  } catch {
    /* blocked storage: the order still holds until the page is closed */
  }
};

/** `name` takes the place of `target`; the schools between shift over by one. */
const moveTo = (list: string[], name: string, target: string) => {
  const from = list.indexOf(name);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
};

const openedLabel = (at: number) => {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(at))) / 86_400_000);
  if (diff <= 0) return 'Opened today';
  if (diff === 1) return 'Opened yesterday';
  return `Opened ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

export const SchoolSelect = () => {
  const { user, setSelectedSchool, logout } = useAuth();
  const navigate = useNavigate();
  // Address and grade range come from the School registry, not a hardcoded map.
  const { schools: registry } = useSchools();
  // Card under the pointer (or keyboard focus): it fills solid with its colour.
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [sort, setSort] = useState<SortMode>('az');
  // Drag-and-drop arranging. `order` is the saved order of school names; a
  // school missing from it (a newly added one) sorts after the arranged ones.
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  const isAdmin = user?.role === 'system_admin';
  const userId = user?.id;

  // Load the saved order once per account; an admin who has one starts on it.
  useEffect(() => {
    if (!userId) return;
    const saved = loadOrder(userId);
    setOrder(saved);
    if (saved.length > 0) setSort('mine');
  }, [userId]);
  const recent = useMemo(() => (user && isAdmin ? loadRecent(user.id) : []), [user, isAdmin]);

  // Registry rows keyed by name, and the creation order ("newest" sort).
  const byName = useMemo(() => new Map(registry.map((r) => [r.school_name, r])), [registry]);
  const createdRank = useMemo(() => {
    const ids = [...registry].sort((a, b) => a._id.localeCompare(b._id)).map((r) => r.school_name);
    return new Map(ids.map((n, i) => [n, i]));
  }, [registry]);

  const visibleSchools = useMemo(() => {
    if (!user) return [];
    const q = query.trim().toLowerCase();
    const list = user.schools.filter((name) => {
      if (arranging) return true;
      const rec = byName.get(name);
      if (level !== 'all' && levelOf(rec) !== level) return false;
      if (!q) return true;
      const hay = [name, rec?.school_nickname, rec?.street_address, rec?.barangay, rec?.city].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    // Everyone but a System Admin, and anyone while arranging, uses their own
    // order (A to Z until they set one). Search and filters are off in that case.
    const mode: SortMode = isAdmin && !arranging ? sort : 'mine';
    const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    return list.sort((a, b) =>
      mode === 'newest' ? (createdRank.get(b) ?? 0) - (createdRank.get(a) ?? 0)
      : mode === 'za' ? b.localeCompare(a)
      : mode === 'mine' ? (rank(a) - rank(b) || a.localeCompare(b))
      : a.localeCompare(b));
  }, [user, isAdmin, arranging, query, level, sort, order, byName, createdRank]);

  if (!user) return null;

  const handleSelectSchool = (school: string | null) => {
    if (isAdmin) saveRecent(user.id, school ?? ALL_SCHOOLS);
    setSelectedSchool(school);
    navigate('/');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const showAll = user.schools.length > 1;

  // ⚠ ALL SCHOOLS, restored (Sprint 180). Sprint 67 made this a real option in
  // the old sidebar dropdown; the Switch School page replaced that dropdown and
  // listed only the three schools, so adopting it removed the cross-school view
  // entirely, while a dozen screens still branch on it. FhsisReport prints the
  // words "All schools" on a filed return, DentalChartNav shows it as the
  // kicker, and a day note saved with no school is the barangay-wide one. It is
  // also what the BHO STAFF ROLE IS FOR: "consolidated reports across all
  // schools" (CLAUDE.md). ⚠ Shown only to users who actually hold every school:
  // a school_admin pinned to one must not be offered a view across all three,
  // and `user.schools` is already that list.
  // ⚠ The sentinel is ALL_SCHOOLS ('__ALL__'), not null and not ''.
  // `schoolChoiceMade` is `schoolChoice !== null`, so null means "has not chosen
  // yet" and RootLayout bounces back here; '' is not a school name, so
  // `schools.includes('')` fails on the next load. The context maps '__ALL__' to
  // a null `selectedSchool`, which is what every screen reads.
  const allSchoolsCard = (
    <button
      onClick={() => handleSelectSchool(ALL_SCHOOLS)}
      className="group w-full text-left bg-card rounded-2xl border-2 border-border p-6 transition-colors hover:bg-muted/40"
    >
      <div className="w-full h-1.5 rounded-full mb-5 bg-primary" />
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-surface">
          <Layers className="w-6 h-6 text-primary" />
        </div>
      </div>
      <h2 className="font-bold text-foreground mb-1">All schools</h2>
      <p className="text-sm text-muted-foreground">
        Every school at once, the view the consolidated DOH reports are filed from.
      </p>
    </button>
  );

  const schoolCard = (school: string) => {
    const sc = getSchoolColor(school);
    const rec = byName.get(school);
    const range = rec ? schoolGradeRange(rec) : { from: '', to: '' };
    const address = rec ? [rec.street_address, rec.barangay, rec.city].filter(Boolean).join(', ') : '';
    const levels = range.from && range.to ? `${range.from} – ${range.to}` : '';
    const on = active === school;
    const soft = 'rgba(255, 255, 255, 0.22)';
    const inner = (
      <>
        {/* School color bar */}
        <div style={{ backgroundColor: on ? 'rgba(255, 255, 255, 0.6)' : sc.solid }} className="w-full h-1.5 rounded-full mb-5 transition-colors duration-200" />

        {/* Icon + name */}
        <div className="flex items-start justify-between mb-4">
          <div style={{ backgroundColor: on ? soft : sc.light }} className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-200">
            <School style={{ color: on ? '#fff' : sc.solid }} className="w-6 h-6" />
          </div>
          <ChevronRight style={{ color: on ? '#fff' : sc.solid }} className="w-5 h-5 mt-1 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
        </div>

        <div style={{ color: on ? '#fff' : sc.text }} className="font-bold text-base leading-tight mb-1 min-h-[2.5rem] transition-colors duration-200">
          {school}
        </div>

        <div className={`flex items-center gap-1 text-xs mt-2 transition-colors duration-200 ${on ? 'text-white/90' : 'text-muted-foreground'}`}>
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>{address}</span>
        </div>

        <div className="mt-3 pt-3 border-t transition-colors duration-200" style={{ borderColor: on ? 'rgba(255, 255, 255, 0.3)' : undefined }}>
          {levels && (
            <span style={{ backgroundColor: on ? soft : sc.light, color: on ? '#fff' : sc.text }} className="text-xs font-medium px-2 py-1 rounded-full transition-colors duration-200">
              {levels}
            </span>
          )}
        </div>
      </>
    );

    if (arranging) {
      // Draggable cards: no hover fill, no selecting a school, a grip in the corner.
      return (
        <div
          key={school}
          draggable
          onDragStart={(e) => { setDragging(school); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', school); }}
          onDragEnter={() => {
            if (!dragging || dragging === school) return;
            const next = moveTo(visibleSchools, dragging, school);
            setOrder(next);
            saveOrder(user.id, next);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          onDragEnd={() => setDragging(null)}
          style={{ borderColor: sc.border }}
          className={`relative w-full cursor-grab select-none bg-card rounded-2xl border-2 border-dashed p-6 shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-opacity active:cursor-grabbing ${dragging === school ? 'opacity-40' : ''}`}
        >
          <GripVertical className="absolute right-3 top-4 w-5 h-5 text-[#94A3B8]" aria-hidden="true" />
          {inner}
        </div>
      );
    }

    return (
      <button
        key={school}
        onClick={() => handleSelectSchool(school)}
        onMouseEnter={() => setActive(school)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(school)}
        onBlur={() => setActive(null)}
        style={{ borderColor: on ? sc.solid : sc.border, backgroundColor: on ? sc.solid : undefined }}
        className="group w-full text-left bg-card rounded-2xl border-2 p-6 transition-colors duration-200"
      >
        {inner}
      </button>
    );
  };

  const noSchools = (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
      <School className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
      <h2 className="font-semibold text-yellow-800 mb-1">No School Assigned</h2>
      <p className="text-yellow-700 text-sm">Please contact the System Administrator to assign you to a school.</p>
    </div>
  );

  const logoutButton = (
    <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-danger-surface rounded-lg transition-colors">
      <LogOut className="w-4 h-4" />
      <span>Logout</span>
    </button>
  );

  const brand = (
    <div className="flex items-center gap-3">
      <img src="/logo.svg" alt="FLORAL" className="w-14 h-14 object-contain flex-shrink-0" />
      <div>
        <div className="text-2xl font-bold text-[#1E40AF]">FLORAL</div>
        <div className="text-sm text-muted-foreground -mt-0.5">Dental Health Record Management System</div>
      </div>
    </div>
  );

  // Same page for every role. Search, filters, sort, recent schools and the
  // All schools card are System Admin only.
  const recentTiles = !isAdmin ? [] : recent.filter((r) => r.school === ALL_SCHOOLS ? showAll : user.schools.includes(r.school));
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex flex-col">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {brand}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end leading-tight">
              <div className="text-xs text-muted-foreground">Welcome back,</div>
              <div className="text-sm font-bold text-foreground">{user.name}</div>
              <span className={`mt-1.5 px-2.5 py-0.5 text-[10px] rounded-full font-medium ${roleBadgeColors[user.role]}`}>{roleLabels[user.role]}</span>
            </div>
            {logoutButton}
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-10">
        <div className="max-w-[1400px] mx-auto">
          {user.schools.length === 0 ? noSchools : (
            <>
              <div className="text-center">
                <img src="/logo.svg" alt="" aria-hidden="true" className="w-16 h-16 object-contain mx-auto" />
                <h1 className="mt-2 text-2xl font-bold text-foreground">
                  {isAdmin ? 'Which school do you want to manage?' : `Where are you working today, ${user.name}?`}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isAdmin
                    ? `${user.schools.length} registered school${user.schools.length === 1 ? '' : 's'}. Choose one to manage, or open all schools together.`
                    : user.schools.length === 1 ? 'There is 1 school assigned to your account.' : `There are ${user.schools.length} schools assigned to your account.`}
                </p>
                {isAdmin && !arranging && (
                  <>
                <div className="relative mx-auto mt-5 max-w-2xl">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Type a school name"
                    aria-label="Search schools"
                    className="w-full rounded-2xl border-2 border-[#16214F] bg-white py-3.5 pl-12 pr-4 text-base text-foreground shadow-[0_8px_30px_rgba(22,33,79,0.12)] focus:outline-none focus:ring-2 focus:ring-[#16214F]/30"
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  {LEVEL_CHIPS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setLevel(c.key)}
                      aria-pressed={level === c.key}
                      className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                        level === c.key ? 'bg-[#16214F] border-[#16214F] text-white' : 'bg-white border-[#E2E8F0] text-[#475569] hover:bg-gray-50'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                  <SortMenu value={sort} onChange={setSort} />
                </div>
                  </>
                )}
              </div>

              {recentTiles.length > 0 && (
                <div className="mt-8">
                  <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">Recently opened</div>
                  <div className="flex flex-wrap gap-3.5">
                    {recentTiles.map((r) => {
                      const isAll = r.school === ALL_SCHOOLS;
                      const sc = isAll ? null : getSchoolColor(r.school);
                      return (
                        <button
                          key={r.school}
                          onClick={() => handleSelectSchool(isAll ? ALL_SCHOOLS : r.school)}
                          className="flex w-[258px] items-center gap-3.5 rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3 text-left transition-colors hover:bg-muted/40"
                        >
                          <span className="h-9 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: sc?.solid ?? '#273A78' }} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold" style={{ color: sc?.text ?? '#0f172a' }}>{isAll ? 'All schools' : r.school}</span>
                            <span className="block text-xs text-muted-foreground">{openedLabel(r.at)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-8 mb-2.5 flex items-center gap-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                  {isAdmin ? 'All schools' : 'Assigned Schools'}{visibleSchools.length !== user.schools.length ? ` (${visibleSchools.length} of ${user.schools.length})` : ''}
                </div>
                {user.schools.length > 1 && (
                  arranging ? (
                    <button
                      onClick={() => { setArranging(false); setDragging(null); }}
                      className="inline-flex h-7 items-center rounded-lg bg-[#16214F] px-3 text-xs font-medium text-white hover:opacity-90"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => { setArranging(true); setActive(null); }}
                      title="Rearrange schools"
                      aria-label="Rearrange schools"
                      className="text-[#94A3B8] transition-colors hover:text-[#334155]"
                    >
                      <ArrowUpDown className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  )
                )}
              </div>
              {arranging && (
                <div className="mb-3 text-[11px] text-destructive">
                  <b>Rearranging schools.</b> Drag a card to a new spot. Your order saves as you go.
                </div>
              )}
              {/* Cards keep one fixed width and start at the left; a new school
                  simply lands at the end and the row wraps. */}
              <div className="grid gap-5 justify-start [grid-template-columns:repeat(auto-fill,258px)]">
                {isAdmin && showAll && !arranging && !query.trim() && level === 'all' && allSchoolsCard}
                {visibleSchools.map(schoolCard)}
              </div>
              {visibleSchools.length === 0 && (
                <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
                  <span className="w-[4.5rem] h-[4.5rem] rounded-2xl grid place-items-center bg-[#F1F5F9] text-[#94A3B8]"><SearchX className="w-8 h-8" /></span>
                  <div className="mt-5 text-base font-bold text-foreground">No schools found</div>
                  <div className="mt-2 text-xs text-muted-foreground">Try a different name, or choose All.</div>
                  <button
                    onClick={() => { setQuery(''); setLevel('all'); }}
                    className="mt-4 rounded-full border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-semibold text-[#475569] hover:bg-gray-50"
                  >
                    Clear search and filters
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
