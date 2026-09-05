import { Outlet, Link, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, Calendar, Brain,
  ClipboardList, LogOut, Stethoscope, Shield,
  Clipboard, FileBarChart, UserCog,
  ChevronLeft, ChevronRight, Menu, X, School, Archive, Bell, Settings, ArrowLeftRight
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getSchoolColor, getSchoolShortName } from '../utils/schoolColors';
import { TOPBAR_H } from '../utils/layout';
import { SyncStatus } from './SyncStatus';
import { useNotifications, NOTIFIED_ROLES } from '../hooks/useNotifications';
import { apiClient, ApiError } from '../api/client';
import { useToast } from './Toast';
import { Modal } from './Modal';


export const Root = () => {
  const { user, logout, selectedSchool } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // Desktop-only manual collapse. Not persisted per-breakpoint: below md the
  // sidebar is an off-canvas drawer and `collapsed` is ignored entirely.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebarCollapsed', String(!prev));
      return !prev;
    });
  };

  // Mobile navigation drawer (Sprint 33). Below md the sidebar used to shrink
  // to a 60px icon rail with every label hidden and no working tooltip --
  // ten unlabeled glyphs. It is now off-canvas and fully labeled.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close on navigation. Covers back/forward too; TabLink also closes on click
  // so that re-selecting the CURRENT route (no pathname change) still closes.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Escape to close, Tab trapped inside, background scroll locked. Focus moves
  // into the drawer on open and back to the hamburger on close.
  useEffect(() => {
    if (!drawerOpen) return;
    const el = drawerRef.current;
    if (!el) return;

    const SEL = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(SEL)).filter((n) => n.offsetParent !== null);

    focusable()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDrawerOpen(false); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  // High-risk count for the Risk Classification badge — one light server
  // aggregate (Sprint 23p) instead of the dashboard's 6-collection fetch.
  const [highRiskCount, setHighRiskCount] = useState(0);
  useEffect(() => {
    if (user?.role !== 'dentist') return;
    const q = selectedSchool ? `?school=${encodeURIComponent(selectedSchool)}` : '';
    apiClient.get<{ count: number }>(`/stats/high-risk-count${q}`)
      .then((r) => setHighRiskCount(r.count))
      .catch(() => setHighRiskCount(0));
  }, [user?.role, selectedSchool]);

  // Sidebar bell (Sprint 97). One server aggregate, same pattern as the badge
  // above — the sidebar renders on every screen, so it must not mount the
  // six-collection hooks these counts come from.
  const { counts: notifCounts } = useNotifications(NOTIFIED_ROLES.includes(user?.role ?? ''), selectedSchool);

  // ⚠ THE BADGE COUNTS ONLY THE ROWS THIS ROLE CAN SEE. Risk validation is
  // dentist-only (nav tab 5), so for an aide or admin that row is hidden — and
  // a badge saying "3" above a list showing two items is the kind of number
  // nobody can reconcile. The hook's own `total` is deliberately not used here.
  const canValidateRisk = user?.role === 'dentist';
  const notifTotal =
    notifCounts.overdueRpc +
    notifCounts.appointmentsToday +
    notifCounts.remindersToday +
    (canValidateRisk ? notifCounts.awaitingValidation : 0);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const openChangePassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordError(null);
    setShowChangePassword(true);
  };

  const handleChangePassword = async () => {
    setChangePasswordError(null);
    if (newPassword.length < 8) {
      setChangePasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangePasswordError('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await apiClient.patch('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed.');
      setShowChangePassword(false);
    } catch (err) {
      setChangePasswordError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (!user) return null;

  // System Admin is the super user and reaches every OPERATIONAL screen, not
  // just the three admin ones — the server already agreed (CLINICAL_WRITE_ROLES
  // includes system_admin, and reads default to all roles), so only this nav
  // was hiding them.
  //
  // ⚠ Risk Classification is the ONE deliberate exception. Validating an AI
  // recommendation there is recorded as clinical sign-off in the audit trail,
  // and CLAUDE.md's premise is that the DENTIST validates every recommendation
  // before clinical action. Adding 'system_admin' to id 5 would let a
  // non-clinician sign off, which weakens the guarantee Chapter 3 rests on.
  // It is a one-word change if that is wanted — make it deliberately.
  const allTabs = [
    {
      id: 1, path: '/', label: 'Dashboard', icon: LayoutDashboard,
      roles: ['dentist','dental_aide','school_admin','bho_staff','system_admin']
    },
    {
      id: 2, path: '/appointments', label: 'Appointments', icon: Calendar,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 3, path: '/patients', label: 'Students', icon: Users,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 4, path: '/dental-charts', label: 'Dental Charts', icon: Stethoscope,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 5, path: '/ai-analytics', label: 'Risk Classification', icon: Brain,
      roles: ['dentist']
    },
    {
      id: 6, path: '/treatment-records', label: 'Treatment', icon: Clipboard,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 7, path: '/rpc', label: 'RPC Tracking', icon: Shield,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 8, path: '/reports', label: 'Reports', icon: FileBarChart,
      roles: ['dentist','dental_aide','school_admin','bho_staff','system_admin']
    },
    {
      id: 9, path: '/schools', label: 'Schools', icon: School,
      roles: ['system_admin']
    },
    {
      id: 10, path: '/accounts', label: 'User Management', icon: UserCog,
      roles: ['system_admin']
    },
    {
      id: 11, path: '/archive', label: 'Archived Records', icon: Archive,
      roles: ['system_admin']
    },
    {
      id: 12, path: '/audit', label: 'Audit Trail', icon: ClipboardList,
      roles: ['system_admin']
    },
    // Follow Up Alerts REMOVED
  ];

  const visibleTabs = allTabs.filter(tab => tab.roles.includes(user.role));


  const handleLogout = async () => { await logout(); navigate('/login'); };

  const isTabActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // Label visibility: always shown below md (the drawer is 280px wide and
  // unlabeled icons were the whole bug), then governed by `collapsed` at md+.
  const labelCls = collapsed ? 'block md:hidden' : 'block';
  const badgeCls = collapsed ? 'inline-block md:hidden' : 'inline-block';

  const TabLink = ({ tab }: { tab: typeof allTabs[0] }) => {
    const isActive = isTabActive(tab.path);
    const Icon = tab.icon;
    return (
      <Link
        to={tab.path}
        onClick={() => setDrawerOpen(false)}
        title={collapsed ? tab.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        // Collapsed, the rail is 60px and px-4 left the 20px icon centred at
        // 26px against the rail's 30px -- 4px off, and misaligned with the
        // footer buttons, which already re-centre themselves when collapsed.
        // Matches what Change Password / Logout do further down.
        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
          collapsed ? 'md:justify-center md:px-0' : ''
        } ${
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground hover:bg-primary-surface'
        }`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className={`${labelCls} text-sm font-medium`}>{tab.label}</span>
        {tab.path === '/ai-analytics' && highRiskCount > 0 && (
          <span className={`${badgeCls} ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
            isActive ? 'bg-white/20 text-white' : 'bg-danger-surface text-destructive'
          }`}>
            {highRiskCount}
          </span>
        )}
      </Link>
    );
  };

  // Same school palette the kicker/GradePill use — the strip must not invent a
  // second colour language for the same school.
  const stripSchool = selectedSchool
    ? getSchoolColor(selectedSchool)
    : { solid: '#1E40AF', light: '#EFF6FF', border: '#93C5FD' };

  return (
    // flex-col below md so the mobile top bar stacks ABOVE the content as a
    // normal flow item. It is `sticky` under the fixed status strip.
    <div className="min-h-screen bg-canvas flex flex-col md:flex-row" style={{ paddingTop: TOPBAR_H }}>
      {/* STATUS STRIP -- pinned to the very top of the viewport, above the
          sidebar in stacking order (z-[60] vs z-50) but NOT across it: it
          starts where the rail ends, so the rail keeps its own full-height
          top corner instead of being covered. Full width below md, where the
          rail is off-canvas. Contents are right-aligned. Two facts staff in
          the field must be able to glance at without scrolling: whether the
          device is online, and which school's records they are looking at.
          `fixed` (not sticky) because it must survive any scroll container on
          the page; the wrapper's paddingTop above is what keeps it from
          covering the first row of content. */}
      <div
        style={{ height: TOPBAR_H }}
        className={`fixed top-0 right-0 left-0 ${collapsed ? 'md:left-[60px]' : 'md:left-[220px]'} z-[60] flex items-center justify-end gap-1.5 px-3 bg-card border-b border-border leading-none transition-[left] duration-200`}
      >
        {/* Two pills, no divider — the rings already separate them. The sync
            pill IS the affordance: clicking it opens the full panel, which is
            why the floating cloud icon it replaced is gone entirely. */}
        <SyncStatus />
        <span
          style={{
            backgroundColor: stripSchool.light,
            color: stripSchool.solid,
            borderColor: stripSchool.border,
          }}
          className="inline-flex items-center rounded-full border px-2.5 py-[2px] text-[13px] font-semibold leading-none truncate max-w-[45vw]"
        >
          {selectedSchool ? getSchoolShortName(selectedSchool) : 'All Schools'}
        </span>
      </div>

      {/* MOBILE TOP BAR -- below md only; the drawer's only entry point. The
          old `pr-14` reserved the corner for the floating SyncStatus icon,
          which no longer renders inside the shell. */}
      <header style={{ top: TOPBAR_H }} className="md:hidden sticky h-14 z-30 flex items-center gap-3 px-4 bg-card border-b border-border">
        <button
          ref={menuButtonRef}
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          aria-controls="main-nav"
          className="-ml-2 p-2 rounded-lg text-foreground hover:bg-primary-surface transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-base font-bold text-primary">FLORAL</span>
        {/* The school name used to repeat here. The status strip above now
            carries it at every width, so this was the same label twice on a
            phone screen. */}
      </header>

      {/* DRAWER BACKDROP -- below md only */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
          className="md:hidden fixed inset-0 bg-black/40 z-40"
        />
      )}

      {/* LEFT TAB BAR -- off-canvas drawer below md, fixed rail at md+.
          `invisible` when closed keeps the offscreen drawer out of the tab
          order and the accessibility tree; md:visible restores the desktop
          sidebar unconditionally. */}
      <aside
        ref={drawerRef}
        id="main-nav"
        // z-[70], ABOVE the status strip's z-[60]. The collapse toggle inside is
        // `absolute -right-3 top-5`, so it deliberately pokes 12px past the rail
        // into the strip's horizontal range and sits at y 20-44px, inside the
        // 48px strip — at z-50 the strip painted straight over it and the button
        // could not be clicked. z-index on the button itself cannot fix this:
        // this aside's own z-index makes it a stacking context, so a child can
        // never escape it. The rail has to win, and it does not overlap the
        // strip anywhere else.
        className={`bg-card border-r border-border flex flex-col fixed left-0 top-0 h-screen z-[70]
          w-[280px] transition-transform duration-200
          ${drawerOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}
          md:visible md:translate-x-0 md:transition-[width]
          ${collapsed ? 'md:w-[60px]' : 'md:w-[220px]'}`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-border relative">
          {/* Collapse toggle -- desktop only, mobile has no room to expand anyway */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex absolute -right-3 top-5 w-6 h-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-gray-50 shadow-sm z-10"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="FLORAL" className="w-8 h-8 md:w-10 md:h-10 object-contain flex-shrink-0" />
            <div className={labelCls}>
              <div className="text-lg font-bold text-primary">FLORAL</div>
              <div className="text-xs text-muted-foreground leading-tight">Dental Health Record Management System</div>
            </div>
            {/* Close -- drawer only; Escape and the backdrop also close it */}
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation menu"
              className="md:hidden ml-auto -mr-2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-primary-surface transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* School switcher — a button to the dedicated selection screen
            (reverted 2026-09-04 at the user's explicit request from the
            Sprint 67 inline dropdown, which traded this navigation away for
            never leaving the current screen; if that trade-off is missed
            later, that history is why the dropdown existed). Hidden for
            single-school accounts, where switching is meaningless. */}
        {(user.schools.length > 1) && (
          <button
            onClick={() => navigate('/select-school')}
            title="Switch School"
            aria-label="Switch School"
            className={`group flex items-center gap-2.5 mx-3 my-2 px-3 py-2.5 rounded-xl border border-primary/15 bg-primary-surface text-primary hover:border-primary/30 hover:shadow-sm transition-all ${collapsed ? 'md:justify-center' : ''} w-[calc(100%-24px)]`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card shadow-sm group-hover:scale-105 transition-transform">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </span>
            <span className={`${labelCls} text-sm font-semibold`}>Switch School</span>
          </button>
        )}

        {/* Tabs */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleTabs.map((tab) => (
            <TabLink key={tab.id} tab={tab} />
          ))}
        </nav>

        {/* User info + settings + notifications + logout */}
        <div className="border-t border-border p-4">
          <div className={`flex items-center justify-between gap-2 mb-3 ${collapsed ? 'md:justify-center' : ''}`}>
            <div className={`min-w-0 ${labelCls}`}>
              <div className="text-sm font-medium text-foreground truncate">{user.name}</div>
              <div className="mt-1">
                <span className="inline-block px-2 py-0.5 text-xs bg-primary-surface text-primary rounded capitalize">
                  {user.role.replace('_', ' ')}
                </span>
              </div>
            </div>
            {/* Profile settings — currently just Change Password, the one
                self-service profile action that exists. Not a menu of
                invented options (CLAUDE.md: nothing cosmetic). */}
            <button
              onClick={openChangePassword}
              title="Profile settings"
              aria-label="Profile settings"
              className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Notifications — ABOVE Logout, as the P2 doc asked ("notifications
              above ng log out"). Hidden entirely for School Admin and BHO
              staff: they view reports, never clinical records, so every count
              would be both zero and none of their business. Links straight to
              the full notifications page rather than an inline dropdown. */}
          {NOTIFIED_ROLES.includes(user.role) && (
            <Link
              to="/notifications"
              onClick={() => setDrawerOpen(false)}
              title={collapsed ? `Notifications${notifTotal ? ` (${notifTotal})` : ''}` : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2 text-muted-foreground hover:bg-muted rounded-lg transition-colors mb-1 justify-start ${collapsed ? 'md:justify-center' : 'md:justify-start'}`}
            >
              <span className="relative flex-shrink-0">
                <Bell className="w-5 h-5" />
                {notifTotal > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center">
                    {notifTotal > 99 ? '99+' : notifTotal}
                  </span>
                )}
              </span>
              <span className={`${labelCls} text-sm font-medium`}>Notifications</span>
            </Link>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 text-destructive hover:bg-danger-surface rounded-lg transition-colors justify-start ${collapsed ? 'md:justify-center' : 'md:justify-start'}`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className={`${labelCls} text-sm font-medium`}>Logout</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      {/* MAIN CONTENT -- full width below md (the drawer is off-canvas), offset
          by the fixed rail at md+. No top padding needed: the mobile bar is a
          flow sibling above, not an overlay. */}
      {/* `overflow-x-clip`, NOT `overflow-x-hidden`. They look identical here but
          `hidden` makes this element a scroll container, and a scroll container
          ancestor is what `position: sticky` pins against -- so every sticky
          header inside the page (the IPTR toolbar and tab strip) was pinning to
          a box that never scrolls, i.e. silently not sticking at all. `clip`
          clips the same overflow without becoming a scroll container. */}
      <main className={`flex-1 ml-0 ${collapsed ? 'md:ml-[60px]' : 'md:ml-[220px]'} overflow-x-clip transition-[margin] duration-200`}>
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Change Password Modal */}
      {showChangePassword && (
        <Modal onClose={() => setShowChangePassword(false)} closeDisabled={changingPassword}>
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Change Password</h2>
            </div>
            <>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  {changePasswordError && <p className="text-sm text-destructive">{changePasswordError}</p>}
                </div>
                <div className="flex gap-3 p-6 border-t border-border">
                  <button
                    onClick={() => setShowChangePassword(false)}
                    className="flex-1 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleChangePassword}
                    disabled={changingPassword}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-60 transition-colors"
                  >
                    {changingPassword ? 'Changing…' : 'Change Password'}
                  </button>
                </div>
            </>
        </Modal>
      )}
    </div>
  );
};
