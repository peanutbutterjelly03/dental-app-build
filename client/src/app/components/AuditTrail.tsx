import { useMemo, useState } from 'react';
import { Search, Filter, Calendar, Download } from 'lucide-react';
import { useAuditTrail, windowStart, AUDIT_WINDOW_DAYS } from '../hooks/useAuditTrail';
import { exportToCsv, type ExportColumn } from '../utils/exportCsv';
import { exportToXlsx } from '../utils/exportXlsx';
import { ExportMenu, type ExportFormat } from './ExportMenu';
import { toLocalDateString, formatDateTime } from '../utils/localDate';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';

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
    const matchesSearch =
      log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.module.toLowerCase().includes(searchTerm.toLowerCase());
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

  const handleExport = (format: ExportFormat) => {
    const columns: ExportColumn<(typeof filteredLogs)[number]>[] = [
      { label: 'Timestamp', value: (log) => formatTimestamp(log.timestamp) },
      { label: 'User', value: (log) => log.user },
      { label: 'Action', value: (log) => log.action },
      { label: 'Module', value: (log) => log.module },
      { label: 'Record ID', value: (log) => log.affectedRecordId },
    ];
    const base = `audit_trail_${toLocalDateString(new Date())}`;
    if (format === 'xlsx') void exportToXlsx(filteredLogs, columns, `${base}.xlsx`, 'Audit Trail');
    else exportToCsv(filteredLogs, columns, `${base}.csv`);
  };

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Trail</h1>
          {/* Says WHICH logs are counted. A bare count over a bounded window
              reads as the whole history and would understate it silently. */}
          <p className="text-muted-foreground mt-1">
            {filteredLogs.length} activity {filteredLogs.length === 1 ? 'log' : 'logs'}
            {' · '}
            {fetchFrom === null
              ? 'all time'
              : `since ${fetchFrom.toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {fetchFrom !== null && (
            <button
              onClick={() => setShowAll(true)}
              className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg text-foreground hover:bg-gray-50"
            >
              Show earlier
            </button>
          )}
          <ExportMenu onExport={handleExport} />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Filters</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
              />
            </div>
          </div>

          {/* User Filter */}
          <div>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
            >
              {users.map((user) => (
                <option key={user} value={user}>
                  {user === 'all' ? 'All Users' : user}
                </option>
              ))}
            </select>
          </div>

          {/* Module Filter */}
          <div>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
            >
              {modules.map((module) => (
                <option key={module} value={module}>
                  {module === 'all' ? 'All Modules' : module}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent text-sm"
              />
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Timestamp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Module</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Record ID</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{formatTimestamp(log.timestamp)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-foreground">{log.user}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${getActionColor(log.action)}`}>{log.action}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">{log.module}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-muted-foreground font-mono">{log.affectedRecordId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-4">
        {filteredLogs.map((log) => (
          <div key={log.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-medium text-foreground">{log.user}</div>
                <div className="text-xs text-muted-foreground mt-1">{formatTimestamp(log.timestamp)}</div>
              </div>
              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">{log.module}</span>
            </div>
            <div className="space-y-2">
              <div>
                <span className={`text-sm font-medium ${getActionColor(log.action)}`}>{log.action}</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">{log.affectedRecordId}</div>
            </div>
          </div>
        ))}
      </div>

      {filteredLogs.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <Filter className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No audit logs found matching your filters.</p>
          {fetchFrom !== null && (
            <p className="text-sm mt-1">
              Only the last {AUDIT_WINDOW_DAYS} days are loaded —{' '}
              <button onClick={() => setShowAll(true)} className="underline hover:text-foreground">
                show earlier
              </button>.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
