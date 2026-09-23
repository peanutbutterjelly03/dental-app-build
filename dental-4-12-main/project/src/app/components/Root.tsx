import { Outlet, Link, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, Calendar, Brain,
  ClipboardList, LogOut, Stethoscope, Shield,
  Clipboard, FileBarChart, UserCog,
  ChevronDown, Menu, X, School, Archive, Bell, ArrowLeftRight
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getSchoolShortName } from '../utils/schoolColors';
import { TOPBAR_H } from '../utils/layout';
import { SyncStatus } from './SyncStatus';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { useNotifications, NOTIFIED_ROLES } from '../hooks/useNotifications';
import { apiClient, ApiError } from '../api/client';
import { useToast } from './Toast';
import { Modal } from './Modal';

// Real working dropdown, matching RAMHIS's topbar.jsx exactly (sizes, radii,
// the "Signed in as" panel) -- the avatar used to just open Change Password
// directly with no menu at all.
const UserMenu = ({ user, onAccountSettings }: { user: { name: string; role: string }; onAccountSettings: () => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const firstLetter = user.name.charAt(0).toUpperCase();
  // Real connectivity, same source SyncStatus tracks -- not decorative.
  const { isOnline } = useOfflineQueue();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-3 rounded-2xl px-2 py-1.5 transition-all duration-200 ${
          open ? 'border border-border bg-card shadow-sm' : 'border border-transparent bg-transparent hover:bg-card'
        }`}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white text-sm font-bold shadow-[0_6px_18px_rgba(30,42,94,0.22)]"
          style={{ background: 'linear-gradient(135deg, #4F63D9, #17234D)' }}
        >
          {firstLetter}
        </span>
        <span className="hidden md:flex flex-col items-start min-w-[100px] max-w-[180px]">
          <span className="text-[13px] font-bold text-sidebar-bg truncate max-w-[180px]">{user.name}</span>
          <span className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${isOnline ? 'text-success' : 'text-warning'}`}>
            <span className={`w-[6px] h-[6px] rounded-full ${isOnline ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span className="mt-0.5 text-[11px] font-medium text-muted-foreground capitalize">{user.role.replace('_', ' ')}</span>
        </span>
        <ChevronDown className={`hidden sm:block w-[11px] h-[11px] text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : 'rotate-0'}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] w-[230px] overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)] z-10">
          <div className="mb-2 border-b border-border px-3 py-3">
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Signed in as</span>
            <strong className="mt-1 block truncate text-[13px] font-bold text-sidebar-bg">{user.name}</strong>
            <span className="mt-0.5 block text-[11px] capitalize text-muted-foreground">{user.role.replace('_', ' ')}</span>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); onAccountSettings(); }}
            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-primary-surface hover:text-sidebar-bg"
          >
            <UserCog className="w-4 h-4 text-primary" />
            <span>Account Settings</span>
          </button>
        </div>
      )}
    </div>
  );
};

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
  // Students expandable submenu (Dental Charts, Treatment nested under it),
  // matching RAMHIS's real Pharmacy > Queue/Inventory pattern. Manually
  // toggled OR auto-open when the current route is a child, so landing on
  // /dental-charts directly (not via the chevron) still shows it expanded.
  const [openStudents, setOpenStudents] = useState(false);
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

  // Sidebar bell badge (Sprint 97, moved to its own /notifications page on
  // request). One server aggregate, same pattern as the badge above — the
  // sidebar renders on every screen, so it must not mount the six-collection
  // hooks these counts come from. Only the total is needed here now; the
  // per-category breakdown lives in Notifications.tsx.
  const { counts: notifCounts } = useNotifications(NOTIFIED_ROLES.includes(user?.role ?? ''), selectedSchool);

  // ⚠ THE BADGE COUNTS ONLY THE ROWS THIS ROLE CAN SEE. Risk validation is
  // dentist-only (nav tab 5), so for an aide or admin that row is hidden — and
  // a badge saying "3" above a list showing two items is the kind of number
  // nobody can reconcile. The hook's own `total` is deliberately not used here.
  const notifTotal =
    notifCounts.overdueRpc +
    notifCounts.appointmentsToday +
    notifCounts.remindersToday +
    (user?.role === 'dentist' ? notifCounts.awaitingValidation : 0);

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
    // Rendered as children of Students (see StudentsGroup below), not as
    // their own top-level rows -- requested to match RAMHIS's real
    // Pharmacy > Queue/Inventory expandable-submenu pattern. Kept in
    // allTabs so role filtering stays in one place; the render loop skips
    // them here and draws them nested instead.
    {
      id: 4, path: '/dental-charts', label: 'Dental Charts', icon: Stethoscope,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 6, path: '/treatment-records', label: 'Treatment', icon: Clipboard,
      roles: ['dentist','dental_aide','system_admin']
    },
    {
      id: 5, path: '/ai-analytics', label: 'Risk Classification', icon: Brain,
      roles: ['dentist']
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
      // Moved into the main nav list, right after Reports, on request --
      // was a separate inline popover section above the user block.
      id: 8.5, path: '/notifications', label: 'Notifications', icon: Bell,
      roles: NOTIFIED_ROLES,
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
        // Exact RAMHIS getNavStyle spec: 48px min-height, 12px horizontal
        // padding, 16px rounded corners, 13px type (500 idle / 700 active).
        className={`mx-7 rounded-2xl min-h-12 flex items-center gap-3 px-3 transition-colors ${
          collapsed ? 'md:justify-center md:px-0' : ''
        } ${
          isActive
            ? 'bg-sidebar-active text-sidebar-bg font-bold'
            : 'text-white/70 hover:bg-white/10 hover:text-white font-medium'
        }`}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className={`${labelCls} text-[13px]`}>{tab.label}</span>
        {tab.path === '/ai-analytics' && highRiskCount > 0 && (
          <span className={`${badgeCls} ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
            isActive ? 'bg-sidebar-bg/20 text-sidebar-bg' : 'bg-danger-surface text-destructive'
          }`}>
            {highRiskCount}
          </span>
        )}
        {tab.path === '/notifications' && notifTotal > 0 && (
          <span className={`${badgeCls} ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
            isActive ? 'bg-sidebar-bg/20 text-sidebar-bg' : 'bg-danger-surface text-destructive'
          }`}>
            {notifTotal > 99 ? '99+' : notifTotal}
          </span>
        )}
      </Link>
    );
  };

  // Students + its two children (Dental Charts, Treatment) as an expandable
  // group -- real RAMHIS spec (sidebar.jsx submenuStyle/submenuLinkStyle):
  // indented 20px, left border rule, active child = a light pill (bg-card)
  // on the dark rail rather than the gold TabLink treatment (that's reserved
  // for top-level items). Students itself still navigates normally on click;
  // only the chevron toggles the group, via stopPropagation so it doesn't
  // also trigger the Link.
  const StudentsGroup = ({ studentsTab, children }: { studentsTab: typeof allTabs[0]; children: typeof allTabs }) => {
    const isActive = isTabActive(studentsTab.path);
    const childActive = children.some((c) => isTabActive(c.path));
    // Highlight tracks the REAL route only -- never the manual expand/collapse
    // state. Using `isOpen` here was the bug: toggle the group open, then
    // navigate to an unrelated page, and the gold pill stayed lit because
    // `openStudents` was still true. Expansion (below) is allowed to stay
    // open across navigation; the color is not.
    const highlighted = isActive || childActive;
    const isOpen = openStudents || childActive;
    const Icon = studentsTab.icon;
    // Every click toggles, in addition to navigating -- first click from
    // elsewhere opens it (and lands on Students), a second click while
    // already there closes it, a third reopens it, and so on.
    const onRowClick = () => {
      setDrawerOpen(false);
      setOpenStudents((v) => !v);
    };
    return (
      <div>
        <Link
          to={studentsTab.path}
          onClick={onRowClick}
          title={collapsed ? studentsTab.label : undefined}
          aria-current={isActive ? 'page' : undefined}
          className={`mx-7 rounded-full min-h-12 flex items-center gap-3 px-4 transition-colors ${
            collapsed ? 'md:justify-center md:px-0' : ''
          } ${
            highlighted
              ? 'bg-sidebar-active text-sidebar-bg font-bold'
              : 'text-white/70 hover:bg-white/10 hover:text-white font-medium'
          }`}
        >
          <Icon className="w-4 h-4 flex-shrink-0" />
          <span className={`${labelCls} text-[13px]`}>{studentsTab.label}</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenStudents((v) => !v); }}
            aria-label={isOpen ? 'Collapse Students submenu' : 'Expand Students submenu'}
            aria-expanded={isOpen}
            className={`${labelCls} ml-auto -mr-1 p-0.5 rounded transition-transform ${isOpen ? 'rotate-180' : ''}`}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </Link>

        {isOpen && !collapsed && (
          <div className="mt-1.5 mx-7 flex flex-col gap-1">
            {children.map((child) => {
              const childIsActive = isTabActive(child.path);
              const ChildIcon = child.icon;
              return (
                <Link
                  key={child.id}
                  to={child.path}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={childIsActive ? 'page' : undefined}
                  className={`flex items-center gap-2.5 min-h-[38px] pl-9 pr-3 rounded-full text-[13px] transition-colors ${
                    childIsActive
                      ? 'bg-card text-primary font-semibold'
                      : 'text-white/60 hover:bg-white/10 hover:text-white font-medium'
                  }`}
                >
                  <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    // flex-col below md so the mobile top bar stacks ABOVE the content as a
    // normal flow item. It is `sticky` under the fixed status strip.
    <div className="min-h-screen bg-canvas flex flex-col md:flex-row" style={{ paddingTop: TOPBAR_H }}>
      {/* STATUS STRIP -- pinned to the very top of the viewport, above the
          sidebar in stacking order (z-[60] vs z-50) but NOT across it: it
          starts where the rail ends, so the rail keeps its own full-height
          top corner instead of being covered. Full width below md, where the
          rail is off-canvas. The user avatar is the only permanent content,
          matching the reference topbar exactly -- SyncStatus renders nothing
          at all while online/synced (see its own idle-return-null note) and
          only appears as an actual alert (offline, sync failure, conflict),
          per CLAUDE.md's "show offline banner when disconnected". `fixed`
          (not sticky) because it must survive any scroll container on the
          page; the wrapper's paddingTop above is what keeps it from covering
          the first row of content. */}
      <div
        style={{ height: TOPBAR_H }}
        className={`fixed top-0 right-0 left-0 ${collapsed ? 'md:left-[128px]' : 'md:left-[320px]'} z-[60] flex items-center justify-end gap-3 px-6 bg-white border-b border-[#EEF2F7] leading-none transition-[left] duration-200`}
      >
        <SyncStatus schoolLabel={selectedSchool ? getSchoolShortName(selectedSchool) : 'All Schools'} />
        <UserMenu user={user} onAccountSettings={openChangePassword} />
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
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-bg text-white hover:opacity-90 transition-opacity"
        >
          <Menu className="w-[18px] h-[18px]" />
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
        //
        // Floating, rounded card at md+ (RAMHIS spec: 12px inset, 28px radius,
        // its own border+shadow) -- flush/full-height below md, where it's an
        // off-canvas slide-in drawer instead. Width is now the exact RAMHIS
        // figure too (76/250, was 60/220). Main content's margin and the
        // status strip's left offset stay equal to this RAW width (never
        // width+inset): the floating rail's extra 12px overlaps that much of
        // the content area, hidden by z-index, same as the real RAMHIS layout
        // does it -- its own content div's marginLeft is the sidebar's raw
        // width, not width+inset.
        className={`bg-sidebar-bg flex flex-col fixed left-0 top-0 h-screen z-[70]
          md:left-5 md:top-5 md:bottom-5 md:h-auto md:rounded-[28px] md:border md:border-white/10 md:shadow-[0_18px_45px_rgba(15,23,42,0.22)]
          w-[280px] transition-transform duration-200
          ${drawerOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}
          md:visible md:translate-x-0 md:transition-[width]
          ${collapsed ? 'md:w-[88px]' : 'md:w-[280px]'}`}
      >
        {/* Logo */}
        {/* px-8 shrinks to md:px-0 when collapsed -- at 88px collapsed width,
            32px of padding each side only leaves 24px for the 36px toggle
            button, which doesn't fit and throws its centering off. */}
        <div className={`pt-8 px-8 pb-3 flex items-center gap-3 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
          {/* CSS-hidden (md:hidden), not JS-gated -- collapsed only means
              anything at md+; mobile always ignores it and must keep showing
              the logo regardless of whatever collapsed was left at. */}
          <img src="/logo.svg" alt="FLORAL" className={`w-8 h-8 md:w-10 md:h-10 object-contain flex-shrink-0 ${collapsed ? 'md:hidden' : ''}`} />
          <div className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <div className="text-[19px] font-bold text-white tracking-[0.5px]">FLORAL</div>
            <div className="text-[9px] font-semibold tracking-wide text-white/55 leading-tight uppercase">Dental Health Record Management System</div>
          </div>
          {/* On mobile (below md) this row shows the logo plus an X to close the
              drawer, matching before. At md+ it's the RAMHIS toggle instead: a
              filled dark rounded-square three-line icon, same as the mobile
              hamburger, replacing the old floating chevron circle. */}
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            className="md:hidden ml-auto -mr-2 p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors ${collapsed ? '' : 'ml-auto'}`}
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>
        </div>
        {/* Inset divider -- a margin on both sides instead of a full-width
            border, so the line doesn't touch the rounded card's edges. */}
        <div className={`h-px bg-[#E2E8F0]/90 mx-8 ${collapsed ? "md:mx-2" : ""}`} />

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
            // Same shape/size as a main-menu row (TabLink), just filled: white
            // background + gold border + gold icon/text, matching the RAMHIS
            // reference chip's white-bg/colored-border/colored-text treatment
            // but in the app's gold rather than blue.
            className={`mx-7 mt-2 mb-1 rounded-2xl min-h-12 flex items-center gap-3 px-3 border-2 border-sidebar-active bg-card text-sidebar-active font-bold transition-colors hover:bg-sidebar-active/10 ${
              collapsed ? 'md:justify-center md:px-0' : ''
            }`}
          >
            <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
            <span className={`${labelCls} text-[13px]`}>Switch School</span>
          </button>
        )}

        {/* Tabs */}
        <nav className="flex-1 overflow-y-auto py-5">
          {!collapsed && (
            <div className="px-8 pb-[9px] text-[10px] font-bold uppercase tracking-[1px] text-[#94a3b8]">Main Menu</div>
          )}
          {visibleTabs.map((tab) => {
            // Dental Charts (4) and Treatment (6) render nested inside the
            // Students (3) group below, not as their own row here.
            if (tab.id === 4 || tab.id === 6) return null;
            if (tab.id === 3) {
              const studentsChildren = visibleTabs.filter((t) => t.id === 4 || t.id === 6);
              return <StudentsGroup key={tab.id} studentsTab={tab} children={studentsChildren} />;
            }
            return <TabLink key={tab.id} tab={tab} />;
          })}
        </nav>

        {/* User info + settings + notifications + logout -- exact RAMHIS spec:
            36px avatar chip (bg-primary-50/text-primary-600), 12px name,
            10px muted role, no role badge; logout resting state is muted
            white, not red (red is reserved for the real app's confirm-modal
            icon, which FLORAL doesn't have a matching dialog for). */}
        <div className={`h-px bg-[#E2E8F0]/90 mx-8 ${collapsed ? "md:mx-2" : ""}`} />
        <div className="pt-3 px-8 pb-8">
          {/* Real spec hides this WHOLE block when collapsed (avatar included,
              not just the name/role text) -- CSS-based (md:hidden), not a JS
              conditional, so mobile (which ignores `collapsed`) still shows it
              regardless of whatever the flag was left at. */}
          <div className={`flex items-center gap-2.5 pb-[5px] pt-2.5 mb-1 ${collapsed ? 'md:hidden' : ''}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-surface text-[14px] font-bold" style={{ color: '#4F63D9' }}>
              {user.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex flex-col">
              <strong className="text-[12px] text-white truncate">{user.name}</strong>
              <span className="mt-[3px] text-[10px] text-white/55 capitalize">{user.role.replace('_', ' ')}</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`w-full h-11 flex items-center gap-3 px-3.5 text-[14px] font-medium text-white/55 hover:text-white hover:bg-white/10 rounded-[11px] transition-colors justify-start ${collapsed ? 'md:justify-center' : 'md:justify-start'}`}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={labelCls}>Logout</span>
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
      <main className={`flex-1 ml-0 ${collapsed ? 'md:ml-[128px]' : 'md:ml-[320px]'} overflow-x-clip transition-[margin] duration-200`}>
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
