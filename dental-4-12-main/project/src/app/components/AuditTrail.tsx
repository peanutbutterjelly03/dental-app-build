import { useMemo, useState } from 'react';
import { Search, Filter, Calendar, Download, ClipboardList, Hash } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { useAuditTrail, windowStart, AUDIT_WINDOW_DAYS } from '../hooks/useAuditTrail';
import { formatDateTime } from '../utils/localDate';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';

// Border is inline because styles/index.css forces a grey border on every input.
const FIELD = 'w-full px-4 py-3 text-sm text-[#475569] bg-[#F8FAFC] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#16214F]/30';
const FIELD_STYLE = { border: '1px solid #E2E8F0' } as const;
const CARD = 'bg-card rounded-2xl border border-border shadow-[0_4px_20px_rgba(0,0,0,0.06)]';
const TH = 'px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider';

/** Model names are stored in code form ("MedicalHistory", "StudentIptr"). Put a
 *  space between words for display; IPTR is an acronym, not a word. */
const humanize = (name: string) =>
  name
    .replace(/_/g, ' ')
    .replace(/\b[A-Z]{4,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bIptr\b/g, 'IPTR');

// One colour per module, chosen from the module name so a module keeps the same
// colour on every row and every visit. Text colours are the dark shade of each
// hue so they stay readable on their pale fills.
const MODULE_PALETTE = [
  { bg: '#F4F7FF', fg: '#273A78', border: '#DCE3F5' }, // indigo
  { bg: '#ECFEFF', fg: '#0E7490', border: '#A5F3FC' }, // cyan
  { bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' }, // green
  { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' }, // amber
  { bg: '#FFF1F2', fg: '#BE123C', border: '#FECDD3' }, // rose
  { bg: '#FAF5FF', fg: '#7E22CE', border: '#E9D5FF' }, // purple
  { bg: '#F0F9FF', fg: '#0369A1', border: '#BAE6FD' }, // sky
  { bg: '#FFF7ED', fg: '#C2410C', border: '#FED7AA' }, // orange
];

const moduleColor = (module: string) => {
  let hash = 0;
  for (let i = 0; i < module.length; i++) hash = (hash * 31 + module.charCodeAt(i)) >>> 0;
  return MODULE_PALETTE[hash % MODULE_PALETTE.length];
};

const ModulePill = ({ children }: { children: string }) => {
  const c = moduleColor(children);
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-bold"
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.border }}
    >
      {humanize(children)}
    </span>
  );
};

const UserCell = ({ name, role }: { name: string; role: string }) => (
  <div className="flex items-center gap-3">
    <span className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] text-sm font-bold">{name.trim().charAt(0).toUpperCase()}</span>
    <div className="min-w-0">
      <div className="text-sm font-bold text-foreground">{name}</div>
      {role && <div className="text-xs text-muted-foreground">{role}</div>}
    </div>
  </div>
);

/** The stored action is one code-written string ("Created Student",
 *  "Created RiskStratification (dentist validated: ...)"). Turn it into a bold
 *  title plus ONE short sentence. Only what the string already says is used. */
const CRUD_VERBS: Record<string, (thing: string, an: string, who: string) => string> = {
  Created: (t, _an, who) => `Created a new ${t}${who ? ` for ${who}` : ''}.`,
  Updated: (t, an, who) => (who ? `Updated the ${t} of ${who}.` : `Updated ${an} ${t}.`),
  Archived: (t, an, who) => (who ? `Archived the ${t} of ${who}.` : `Archived ${an} ${t}.`),
  Restored: (t, an, who) => (who ? `Restored the ${t} of ${who}.` : `Restored ${an} archived ${t}.`),
};

/** How a stored model name reads inside a sentence. */
const thingName = (model: string) => {
  const h = humanize(model).toLowerCase();
  if (h === 'student iptr') return 'IPTR';
  if (h === 'student') return 'student record';
  return /record$/.test(h) ? h : `${h} record`;
};

const FIXED_SENTENCES: Record<string, string> = {
  'Login': 'Signed in to the system.',
  '2FA Login': 'Signed in with two-factor authentication.',
  'Changed Password': 'Changed their own password.',
  'Reset Password': 'Reset a user password.',
  'Reset Password via Email': 'Reset their password from an emailed link.',
  'Sent Password Reset Link': 'Sent a password reset link to a user.',
  'Enabled 2FA': 'Turned on two-factor authentication for a user.',
  'Disabled 2FA': 'Turned off two-factor authentication for a user.',
  'Generated Risk Prediction': 'Generated a risk prediction for a student.',
};

const aOrAn = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

const splitAction = (action: string, module: string, subject = '') => {
  const clean = action.trim();
  const base = clean.replace(/\s*\(.*$/, '').trim();
  const [verb, model] = base.split(/\s+/);

  if (FIXED_SENTENCES[base]) return { title: base, detail: FIXED_SENTENCES[base] };

  if (CRUD_VERBS[verb]) {
    if (/dentist validated/i.test(clean)) {
      return { title: verb, detail: subject ? `Dentist validated a risk assessment for ${subject}.` : 'Dentist validated a risk assessment.' };
    }
    const thing = thingName(model || module);
    return { title: verb, detail: CRUD_VERBS[verb](thing, aOrAn(thing), subject) };
  }

  // Unknown action: keep it short and readable rather than dumping the raw string.
  return { title: base || clean, detail: `${humanize(module)} activity.` };
};

export const AuditTrail = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  /** Set when the user asks for everything — no lower bound on the fetch. */
  const [showAll, setShowAll] = useState(false);

  // ⚠ THE FETCH FOLLOWS THE FILTER, and it has to (Sprint 92). The route is
  // now date-bounded, so a Start Date earlier than the window would filter a
  // set that was never fetched and report "No audit logs found" for a period
  // that has plenty — a control that looks like it works and lies, which
  // CLAUDE.md calls out by name. Asking for an earlier start widens the fetch.
  const fetchFrom = useMemo(() => {
    if (showAll) return null;
    const def = windowStart();
    if (!startDate) return def;
    const picked = new Date(startDate);
    if (Number.isNaN(picked.getTime())) return def;
    return picked < def ? picked : def;
  }, [showAll, startDate]);

  const { logs, loading, error } = useAuditTrail(fetchFrom);

  const users = useMemo(() => ['all', ...new Set(logs.map((log) => log.user))], [logs]);
  const modules = useMemo(() => ['all', ...new Set(logs.map((log) => log.module))], [logs]);

  const filteredLogs = useMemo(() => logs.filter((log) => {
    // Searches what the table shows: user, the activity title and sentence
    // (including the student's name), module (as displayed) and record ID.
    const q = searchTerm.trim().toLowerCase();
    const { title, detail } = splitAction(log.action, log.module, log.subject);
    const matchesSearch =
      !q ||
      [log.user, log.userRole, log.action, title, detail, log.module, humanize(log.module), log.subject, log.affectedRecordId]
        .some((v) => v.toLowerCase().includes(q));
    const matchesUser = userFilter === 'all' || log.user === userFilter;
    const matchesModule = moduleFilter === 'all' || log.module === moduleFilter;
    const logDate = new Date(log.timestamp);
    const matchesStart = !startDate || logDate >= new Date(startDate);
    const matchesEnd = !endDate || logDate <= new Date(endDate + ' 23:59:59');

    return matchesSearch && matchesUser && matchesModule && matchesStart && matchesEnd;
  }), [logs, searchTerm, userFilter, moduleFilter, startDate, endDate]);

  // ⚠ SEMANTIC TOKENS, NOT RAW TAILWIND ACCENTS (Sprint 96). The previous
  // green-600/blue-600/red-600/purple-600 measured 3.22:1 on white — below the
  // 4.5:1 AA threshold — and this is the most-read text on the screen: 76
  // failing nodes on one page load. The tokens are the same vocabulary the rest
  // of the app uses and are legible by design (success 5.02:1, warning 5.02:1,
  // destructive 4.83:1, primary 8.72:1).
  //
  // ⚠ `Restored` moved from purple to WARNING rather than gaining a fifth
  // colour. DESIGN.md deliberately restrains the palette to blue/green/amber/red
  // (Sprint 23g), and there is no purple token; amber also reads correctly here,
  // since restoring an archived clinical record is an exceptional admin action
  // worth noticing rather than a routine one.
  const getActionColor = (action: string) => {
    if (action.startsWith('Created')) return 'text-success';
    if (action.startsWith('Updated')) return 'text-primary';
    if (action.startsWith('Archived')) return 'text-destructive';
    if (action.startsWith('Restored')) return 'text-warning';
    return 'text-muted-foreground';
  };

  const formatTimestamp = (iso: string) => formatDateTime(iso);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-destructive">{error}</p>
        <p className="text-sm text-muted-foreground mt-1">Audit trail is restricted to System Admin — make sure you're logged in with that role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header
          Says WHICH logs are counted. A bare count over a bounded window
          reads as the whole history and would understate it silently. */}
      <PageHeader
        icon={ClipboardList}
        eyebrow="System Administration"
        title="Audit Trail"
        description="Monitor system activities and administrative actions."
      />

      {/* Search & Filters */}
      <div className={CARD}>
        <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F1F5F9] text-[#334155] flex-shrink-0"><Filter className="w-5 h-5" /></span>
          <div>
            <div className="text-base font-bold text-foreground">Search &amp; Filters</div>
            <div className="text-sm text-muted-foreground">Search and refine recorded system activities.</div>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search by user, activity, module, or record ID"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`${FIELD} pl-12 py-3.5`}
              style={FIELD_STYLE}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={FIELD} style={FIELD_STYLE} aria-label="Filter by user">
              {users.map((user) => (
                <option key={user} value={user}>{user === 'all' ? 'All Users' : user}</option>
              ))}
            </select>
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className={FIELD} style={FIELD_STYLE} aria-label="Filter by module">
              {modules.map((module) => (
                <option key={module} value={module}>{module === 'all' ? 'All Modules' : humanize(module)}</option>
              ))}
            </select>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8] pointer-events-none" />
              <span className="absolute right-12 top-1/2 -translate-y-1/2 text-xs font-normal text-[#94A3B8] pointer-events-none">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${FIELD} pl-11`} style={FIELD_STYLE} aria-label="Start date" />
            </div>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8] pointer-events-none" />
              <span className="absolute right-12 top-1/2 -translate-y-1/2 text-xs font-normal text-[#94A3B8] pointer-events-none">End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${FIELD} pl-11`} style={FIELD_STYLE} aria-label="End date" />
            </div>
          </div>
        </div>
      </div>

      {/* System Activity */}
      <div className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] flex-shrink-0"><ClipboardList className="w-5 h-5" /></span>
            <div>
              <div className="text-xl font-bold text-foreground">System Activity</div>
              <div className="text-sm text-muted-foreground">View recorded actions across the system.</div>
            </div>
          </div>
          <span className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-bold text-[#64748B] whitespace-nowrap">{filteredLogs.length} {filteredLogs.length === 1 ? 'record' : 'records'} found</span>
        </div>

        {/* Desktop table */}
        {filteredLogs.length > 0 && (
          <div className="hidden lg:block overflow-x-auto border-t border-border">
            <table className="w-full table-fixed min-w-[1000px]">
              <thead className="bg-gray-50 border-b border-border">
                <tr>
                  <th className={TH} style={{ width: '19%' }}>User</th>
                  <th className={TH} style={{ width: '27%' }}>Activity</th>
                  <th className={TH} style={{ width: '14%' }}>Module</th>
                  <th className={TH} style={{ width: '12%' }}>Date</th>
                  <th className={TH} style={{ width: '9%' }}>Time</th>
                  <th className={TH} style={{ width: '19%' }}>Record ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredLogs.map((log) => {
                  const when = new Date(log.timestamp);
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap"><UserCell name={log.user} role={log.userRole} /></td>
                      <td className="px-6 py-4">
                        <div className={`text-sm font-bold ${getActionColor(log.action)}`}>{splitAction(log.action, log.module, log.subject).title}</div>
                        <div className="text-[10px] leading-snug text-muted-foreground mt-0.5 whitespace-normal">{splitAction(log.action, log.module, log.subject).detail}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap"><ModulePill>{log.module}</ModulePill></td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-2"><Calendar className="w-3.5 h-3.5 text-[#94A3B8]" />{when.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-muted-foreground font-mono">
                        <span className="inline-flex items-center gap-2"><Hash className="w-3.5 h-3.5 text-[#94A3B8]" />{log.affectedRecordId}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile and tablet cards */}
        {filteredLogs.length > 0 && (
          <div className="lg:hidden border-t border-border divide-y divide-gray-200">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <UserCell name={log.user} role={log.userRole} />
                  <ModulePill>{log.module}</ModulePill>
                </div>
                <div>
                  <div className={`text-sm font-bold ${getActionColor(log.action)}`}>{splitAction(log.action, log.module, log.subject).title}</div>
                  <div className="text-[10px] leading-snug text-muted-foreground mt-0.5">{splitAction(log.action, log.module, log.subject).detail}</div>
                </div>
                <div className="text-xs text-muted-foreground">{formatTimestamp(log.timestamp)}</div>
                <div className="text-xs text-muted-foreground font-mono">{log.affectedRecordId}</div>
              </div>
            ))}
          </div>
        )}

        {filteredLogs.length === 0 && (
          <div className="border-t border-border flex flex-col items-center justify-center text-center px-6 py-20">
            <span className="w-[4.5rem] h-[4.5rem] rounded-2xl grid place-items-center bg-[#F1F5F9] text-[#94A3B8]"><ClipboardList className="w-8 h-8" /></span>
            <div className="mt-5 text-base font-bold text-foreground">No records found</div>
            <div className="mt-2 text-xs text-muted-foreground">There are no audit logs matching the current filters.</div>
            {fetchFrom !== null && (
              <div className="mt-2 text-xs text-muted-foreground">
                Only the last {AUDIT_WINDOW_DAYS} days are loaded.{' '}
                <button onClick={() => setShowAll(true)} className="underline hover:text-foreground">Show earlier</button>.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
