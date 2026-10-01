import { useState } from 'react';
import { Calendar, X as XIcon, Plus, Edit, Power, Search, KeyRound, Mail, UserCog, Users, UserCheck, UserX, Filter, CheckCircle, User as UserIcon, Shield } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { useUsers, ROLE_LABELS } from '../hooks/useUsers';
import { apiClient, ApiError } from '../api/client';
import type { ApiRole, ApiSchool } from '../api/types';
import { SkeletonPageHeader, SkeletonTable } from './Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Notice } from './Notice';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { useAuth } from '../context/AuthContext';

const ROLES: ApiRole[] = ['dentist', 'dental_aide', 'school_admin', 'bho_staff', 'system_admin'];

// Popup styling shared by the Edit and Reset Password dialogs. The border is
// inline because styles/index.css forces a grey border on every input.
const POPUP_FIELD = 'w-full px-4 py-3 text-sm text-[#475569] bg-[#F8FAFC] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#16214F]/30';
const POPUP_FIELD_STYLE = { border: '1px solid #E2E8F0' } as const;
const POPUP_LABEL = 'block text-sm font-semibold text-foreground mb-2';
const POPUP_SECTION = 'text-sm font-semibold uppercase tracking-[0.08em] text-[#64748B]';
const POPUP_CANCEL = 'px-5 py-2.5 rounded-xl border border-[#E2E8F0] bg-white text-sm font-bold text-foreground hover:bg-gray-50 transition-colors';
const POPUP_PRIMARY = 'px-5 py-2.5 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-60 transition-colors';

const PopupHeader = ({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) => (
  <div className="flex items-start justify-between gap-4 px-8 py-6 border-b border-border">
    <div>
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
    <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 flex-shrink-0 grid place-items-center rounded-xl border border-[#E2E8F0] bg-white text-[#475569] hover:bg-gray-50">
      <XIcon className="w-5 h-5" />
    </button>
  </div>
);

const ROLE_STYLE: Record<ApiRole, { cls: string; icon: typeof UserIcon }> = {
  dentist: { cls: 'bg-[#F4F7FF] text-[#273A78] border-[#DCE3F5]', icon: UserIcon },
  dental_aide: { cls: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]', icon: Users },
  school_admin: { cls: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]', icon: UserCheck },
  bho_staff: { cls: 'bg-[#F0F9FF] text-[#0369A1] border-[#BAE6FD]', icon: Users },
  system_admin: { cls: 'bg-[#FAF5FF] text-[#7E22CE] border-[#E9D5FF]', icon: Shield },
};

/** School assignment picker (Sprint 100). Replaces a single-select dropdown:
 *  one dentist and one aide rotate across all three schools, and other roles
 *  may cover several, which a lone `school_id` could not express.
 *
 *  An EMPTY list means all schools, so the two modes are made explicit with
 *  radios rather than left as "unchecked means everything" — an implicit rule
 *  the admin would have to know. Checkboxes rather than `<select multiple>`:
 *  there are only a handful of schools, and multi-select is close to unusable
 *  on the phone width this app is checked at. */
const SchoolAssignment = ({
  value,
  onChange,
  schools,
  idPrefix,
  role,
  selfId,
  users,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  schools: ApiSchool[];
  idPrefix: string;
  /** Role of the account being edited; a school takes one dentist and one dental aide. */
  role: ApiRole;
  /** The account being edited, so it does not count as holding its own schools. */
  selfId?: string;
  users: { id: string; name: string; role: ApiRole; schoolIds: string[]; status: string }[];
}) => {
  const all = value.length === 0;
  // Who already holds a school in this role. Accounts covering ALL schools
  // (empty list) name no school, so they are not counted. The server enforces
  // the same rule; this only shows the reason before a save is refused.
  const holderOf = (schoolId: string) =>
    role === 'dentist' || role === 'dental_aide'
      ? users.find((u) => u.id !== selfId && u.role === role && u.status === 'Active' && u.schoolIds.includes(schoolId))
      : undefined;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">Assigned Schools</label>
      <div className="border border-border rounded-lg divide-y divide-border">
        <label className="flex items-start gap-3 p-3 cursor-pointer">
          <input
            type="radio"
            name={`${idPrefix}-scope`}
            checked={all}
            onChange={() => onChange([])}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="text-foreground">All schools</span>
            <span className="block text-xs text-muted-foreground">Barangay level — full access, and stays correct if a school is added later.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 p-3 cursor-pointer">
          <input
            type="radio"
            name={`${idPrefix}-scope`}
            checked={!all}
            onChange={() => onChange(schools[0] ? [schools[0]._id] : [])}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="text-foreground">Specific schools</span>
            <span className="block text-xs text-muted-foreground">Pick one or more. A rotating dentist or aide needs every school they cover.</span>
          </span>
        </label>
        {!all && (
          <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
            {schools.map((school) => {
              const holder = holderOf(school._id);
              const blocked = !!holder && !value.includes(school._id);
              return (
                <label key={school._id} className={`flex items-center gap-3 ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={value.includes(school._id)}
                    disabled={blocked}
                    onChange={() => toggle(school._id)}
                  />
                  <span className="text-sm text-foreground">
                    {school.school_name}
                    {blocked && <span className="block text-xs text-muted-foreground">Already has a {role === 'dentist' ? 'dentist' : 'dental aide'}: {holder!.name}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const AccountManagement = () => {
  const { users, schools, loading, error, reload } = useUsers();
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [confirmUser, setConfirmUser] = useState<(typeof users)[number] | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | ApiRole>('all');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'dentist' as ApiRole, school_ids: [] as string[], password: '' });

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'dentist' as ApiRole, school_ids: [] as string[] });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // 2FA management (Sprint 25). Enable is confirmation-gated server-side:
  // initiate emails a code to the account's address, confirm proves the
  // mailbox is real before 2FA can lock anyone out.
  const [twofaStep, setTwofaStep] = useState<'idle' | 'code-sent'>('idle');
  const [twofaCode, setTwofaCode] = useState('');
  const [twofaBusy, setTwofaBusy] = useState(false);
  const [twofaMessage, setTwofaMessage] = useState<string | null>(null);
  const editingUser = users.find((u) => u.id === editingUserId) ?? null;

  const openEdit = (user: (typeof users)[number]) => {
    // Read the ids directly. This used to match `user.school` back to a school
    // BY NAME, which breaks the moment that label reads "2 schools".
    setEditForm({ full_name: user.name, email: user.email, role: user.role, school_ids: user.schoolIds });
    setEditError(null);
    setTwofaStep('idle');
    setTwofaCode('');
    setTwofaMessage(null);
    setEditingUserId(user.id);
  };

  const handleTwofaInitiate = async () => {
    if (!editingUserId) return;
    setTwofaBusy(true);
    setTwofaMessage(null);
    try {
      const res = await apiClient.post<{ message: string }>(`/users/${editingUserId}/twofa/initiate`, {});
      setTwofaStep('code-sent');
      setTwofaMessage(res.message);
    } catch (err) {
      setTwofaMessage(err instanceof ApiError ? err.message : 'Failed to send the confirmation code');
    } finally {
      setTwofaBusy(false);
    }
  };

  const handleTwofaConfirm = async () => {
    if (!editingUserId || !twofaCode) return;
    setTwofaBusy(true);
    try {
      await apiClient.post(`/users/${editingUserId}/twofa/confirm`, { code: twofaCode });
      setTwofaStep('idle');
      setTwofaCode('');
      setTwofaMessage('Two-factor authentication enabled.');
      await reload();
    } catch (err) {
      setTwofaMessage(err instanceof ApiError ? err.message : 'Failed to confirm the code');
    } finally {
      setTwofaBusy(false);
    }
  };

  const handleTwofaDisable = async () => {
    if (!editingUserId) return;
    setTwofaBusy(true);
    try {
      await apiClient.post(`/users/${editingUserId}/twofa/disable`, {});
      setTwofaMessage('Two-factor authentication disabled.');
      await reload();
    } catch (err) {
      setTwofaMessage(err instanceof ApiError ? err.message : 'Failed to disable 2FA');
    } finally {
      setTwofaBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingUserId) return;
    setEditError(null);
    if (!editForm.full_name || !editForm.email) {
      setEditError('Full name and email are required.');
      return;
    }
    setEditSubmitting(true);
    try {
      await apiClient.put(`/users/${editingUserId}`, editForm);
      setEditingUserId(null);
      await reload();
      toast.success('Account updated.');
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update account');
    } finally {
      setEditSubmitting(false);
    }
  };

  const filteredUsers = users.filter(user =>
    (statusFilter === 'all' || user.status === statusFilter) &&
    (roleFilter === 'all' || user.role === roleFilter) &&
    (user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.roleLabel.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  const activeCount = users.filter((u) => u.status === 'Active').length;
  const inactiveCount = users.filter((u) => u.status === 'Inactive').length;

  const handleCreate = async () => {
    setFormError(null);
    if (!form.full_name || !form.email || !form.password) {
      setFormError('Full name, email, and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/users', form);
      setShowCreateForm(false);
      setForm({ full_name: '', email: '', role: 'dentist', school_ids: [], password: '' });
      await reload();
      toast.success('Account created.');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string, status: 'Active' | 'Inactive') => {
    await apiClient.patch(`/users/${id}/${status === 'Active' ? 'archive' : 'restore'}`);
    await reload();
    toast.success(status === 'Active' ? 'Account deactivated.' : 'Account reactivated.');
  };

  // Reactivating is harmless → do it directly. Deactivating locks the account
  // out of login, so it goes through a confirmation step first.
  const requestToggle = (u: (typeof users)[number]) => {
    if (u.status === 'Inactive') {
      void handleToggleStatus(u.id, u.status);
      return;
    }
    setConfirmUser(u);
  };
  const confirmDeactivate = async () => {
    if (!confirmUser) return;
    setDeactivating(true);
    try {
      await handleToggleStatus(confirmUser.id, confirmUser.status);
      setConfirmUser(null);
    } finally {
      setDeactivating(false);
    }
  };

  // Admin-assisted password reset -- System Admin sets a new password
  // directly and relays it out-of-band, no email/reset-token flow needed
  // at this app's scale.
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resettingUserName, setResettingUserName] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetInfo, setResetInfo] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  const openResetPassword = (user: (typeof users)[number]) => {
    setResetPassword('');
    setResetConfirm('');
    setResetError(null);
    setResetInfo(null);
    setResettingUserName(user.name);
    setResettingUserId(user.id);
  };

  const handleResetPassword = async () => {
    if (!resettingUserId) return;
    setResetError(null);
    if (resetPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Passwords do not match.');
      return;
    }
    setResetSubmitting(true);
    try {
      await apiClient.patch(`/users/${resettingUserId}/reset-password`, { password: resetPassword });
      setResettingUserId(null);
      toast.success('Password reset.');
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'Failed to reset password');
    } finally {
      setResetSubmitting(false);
    }
  };

  // Preferred over the direct set: email the user a reset link so they choose
  // their own password (the admin never sees it).
  const handleSendResetLink = async () => {
    if (!resettingUserId) return;
    setResetError(null);
    setResetInfo(null);
    setSendingReset(true);
    try {
      const res = await apiClient.patch<{ message?: string }>(`/users/${resettingUserId}/send-reset`, {});
      setResetInfo(res?.message ?? 'Reset link sent.');
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'Failed to send reset email');
    } finally {
      setSendingReset(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={UserCog}
        eyebrow="Administration"
        title="Account Management"
        description="Manage system users, roles, school assignments and account status."
        action={
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Account
          </button>
        }
      />

      {error && <Notice variant="error">{error}</Notice>}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Users', value: users.length, icon: Users, bg: '#E8ECF6', fg: '#273A78' },
          { label: 'Active Accounts', value: activeCount, icon: UserCheck, bg: '#ECFDF5', fg: '#047857' },
          { label: 'Inactive Accounts', value: inactiveCount, icon: UserX, bg: '#FFF1F2', fg: '#BE123C' },
        ].map(({ label, value, icon: Icon, bg, fg }) => (
          <div key={label} className="flex items-start justify-between gap-3 min-h-[8.5rem] rounded-2xl border border-border bg-card p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
            <div className="min-w-0 self-stretch flex flex-col justify-between">
              <div className="text-sm font-bold uppercase tracking-wider text-foreground">{label}</div>
              <div className="text-4xl font-bold text-foreground mt-3 leading-none">{value}</div>
            </div>
            <span style={{ backgroundColor: bg, color: fg }} className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center">
              <Icon className="w-4 h-4" />
            </span>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="bg-card rounded-2xl border border-border shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-4 px-6 py-5 border-b border-border">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F1F5F9] text-[#334155] flex-shrink-0"><Filter className="w-5 h-5" /></span>
          <div>
            <div className="text-base font-bold text-foreground">Search &amp; Filters</div>
            <div className="text-sm text-muted-foreground">Find and organize user accounts.</div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Search by name, email, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 text-sm bg-[#F8FAFC] rounded-2xl placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#16214F]/30"
              style={{ border: "1px solid #E2E8F0" }}
            />
          </div>
          <div className="flex flex-col lg:flex-row lg:justify-between gap-5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground mb-3">Account Status</div>
              <div className="flex flex-wrap gap-2">
                {([['all', 'All', Users], ['Active', 'Active', CheckCircle], ['Inactive', 'Deactivated', UserX]] as const).map(([v, l, Icon]) => (
                  <button key={v} type="button" onClick={() => setStatusFilter(v)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${statusFilter === v ? 'bg-[#16214F] text-white border-[#16214F]' : 'bg-white text-[#16214F] border-[#E2E8F0] hover:bg-gray-50'}`}><Icon className="w-4 h-4" />{l}</button>
                ))}
              </div>
            </div>
            <div className="lg:text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-foreground mb-3">User Role</div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {(['all', ...ROLES] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setRoleFilter(r)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${roleFilter === r ? 'bg-[#16214F] text-white border-[#16214F]' : 'bg-white text-[#16214F] border-[#E2E8F0] hover:bg-gray-50'}`}>{r === 'all' ? 'All' : ROLE_LABELS[r]}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Account Form */}
      {showCreateForm && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Create New Account</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Full Name</label>
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Dr. Juan Dela Cruz"
                className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Email Address</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="juan.delacruz@floral.com"
                className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as ApiRole })}
                className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
              >
                {ROLES.map(role => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
            </div>
            <SchoolAssignment
              idPrefix="create"
              value={form.school_ids}
              onChange={(school_ids) => setForm({ ...form, school_ids })}
              schools={schools}
              role={form.role}
              users={users}
            />
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">Temporary Password</label>
              {/* new-password: this sets ANOTHER user's password. Without the
                  token the browser would offer the signed-in admin's own saved
                  credentials here (Login gained autoComplete 2026-09-02). */}
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Set an initial password"
                className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent"
              />
              <p className="text-xs text-muted-foreground mt-1">Share this with the user securely; there's no forced password-change flow yet</p>
            </div>
          </div>
          {formError && <p className="text-sm text-destructive mt-3">{formError}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Creating…' : 'Create Account'}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setFormError(null); }}
              className="px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Desktop Table */}
      <div className={`${filteredUsers.length === 0 ? 'block' : 'hidden md:block'} bg-card rounded-2xl border border-border overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.06)]`}>
        <div className="flex items-center justify-between gap-4 px-6 py-7">
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] flex-shrink-0"><Users className="w-5 h-5" /></span>
            <div>
              <div className="text-xl font-bold text-foreground">{statusFilter === 'Active' ? 'Active Users' : statusFilter === 'Inactive' ? 'Deactivated Users' : 'System Users'}</div>
              <div className="text-sm text-muted-foreground">{statusFilter === 'Active' ? 'Manage currently active system accounts.' : statusFilter === 'Inactive' ? 'Review deactivated user accounts.' : 'Review and manage user accounts.'}</div>
            </div>
          </div>
          <span className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-xs font-bold text-[#64748B]">{filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'} found</span>
        </div>
        {filteredUsers.length === 0 ? (
          <div className="border-t border-border flex flex-col items-center justify-center text-center px-6 py-20">
            <span className="w-[4.5rem] h-[4.5rem] rounded-2xl grid place-items-center bg-[#F1F5F9] text-[#94A3B8]"><Users className="w-8 h-8" /></span>
            <div className="mt-5 text-base font-bold text-foreground">No users found</div>
            <div className="mt-2 text-xs text-muted-foreground">There are no users matching the current status, role, or search filters.</div>
          </div>
        ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  Date Added
                </th>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  School
                </th>
                <th className="px-6 py-3 text-left text-[12.5px] font-bold text-[#94A3B8] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className={`hover:bg-gray-50 ${user.pending ? 'opacity-70' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-4">
                      <span className="w-11 h-11 flex-shrink-0 rounded-xl grid place-items-center bg-[#F4F7FF] text-[#273A78] text-sm font-bold">{user.name.trim().charAt(0).toUpperCase()}</span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-foreground flex items-center">
                          {user.name}
                          {user.pending && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">Pending sync</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(() => {
                      const st = ROLE_STYLE[user.role] ?? ROLE_STYLE.dentist;
                      const RoleIcon = st.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${st.cls}`}>
                          <RoleIcon className="w-3.5 h-3.5" />
                          {user.roleLabel}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${
                      user.status === 'Active'
                        ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                        : 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]'
                    }`}>
                      {user.status === 'Active' ? <CheckCircle className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                      {user.status === 'Active' ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {user.createdAt && (
                      <span className="inline-flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-[#94A3B8]" />
                        {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">
                    {user.school}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {!user.pending && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEdit(user)}
                          className="text-primary hover:text-[#1E3A8A]"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openResetPassword(user)}
                          title="Reset Password"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => requestToggle(user)}
                          disabled={user.status === 'Active' && user.id === currentUser?.id}
                          title={user.status === 'Active' && user.id === currentUser?.id ? "You can't deactivate your own account" : user.status === 'Active' ? 'Deactivate' : 'Activate'}
                          className={`disabled:opacity-40 disabled:cursor-not-allowed ${
                          user.status === 'Active'
                            ? 'text-destructive hover:text-red-700'
                            : 'text-success hover:text-green-700'
                        }`}>
                          <Power className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {filteredUsers.map((user) => (
          <div key={user.id} className={`bg-card rounded-xl border border-border p-4 ${user.pending ? 'opacity-70' : ''}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-foreground flex items-center">
                  {user.name}
                  {user.pending && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">Pending sync</span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                user.status === 'Active'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-100 text-foreground'
              }`}>
                {user.status}
              </span>
            </div>
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Role:</span>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                  {user.roleLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">School:</span>
                <span className="text-foreground">{user.school}</span>
              </div>
            </div>
            {!user.pending && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => openEdit(user)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => openResetPassword(user)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  <KeyRound className="w-4 h-4" />
                  Reset Password
                </button>
                <button
                  onClick={() => requestToggle(user)}
                  disabled={user.status === 'Active' && user.id === currentUser?.id}
                  title={user.status === 'Active' && user.id === currentUser?.id ? "You can't deactivate your own account" : undefined}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  user.status === 'Active'
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                }`}>
                  <Power className="w-4 h-4" />
                  {user.status === 'Active' ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Edit Account Modal */}
      {editingUserId && (
        <Modal onClose={() => setEditingUserId(null)} maxWidth="max-w-4xl" rounded="rounded-3xl" closeDisabled={editSubmitting || twofaBusy}>
            <PopupHeader title="Edit Account" subtitle="View and manage this user's information." onClose={() => setEditingUserId(null)} />
            <div className="px-8 py-6 space-y-5">
              <div className={POPUP_SECTION}>Account Information</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <div>
                <label className={POPUP_LABEL}>Full Name</label>
                <input
                  type="text"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  className={POPUP_FIELD} style={POPUP_FIELD_STYLE}
                />
              </div>
              <div>
                <label className={POPUP_LABEL}>Email Address</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className={POPUP_FIELD} style={POPUP_FIELD_STYLE}
                />
              </div>
              </div>
              <div>
                <label className={POPUP_LABEL}>Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as ApiRole })}
                  className={POPUP_FIELD} style={POPUP_FIELD_STYLE}
                >
                  {ROLES.map(role => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
              <SchoolAssignment
                idPrefix="edit"
                value={editForm.school_ids}
                onChange={(school_ids) => setEditForm({ ...editForm, school_ids })}
                schools={schools}
                role={editForm.role}
                selfId={editingUserId ?? undefined}
                users={users}
              />
              <p className="text-xs text-muted-foreground">Password isn't changed here — use the Reset Password action instead.</p>

              {/* Two-factor authentication */}
              <div className="space-y-3">
                <div className={POPUP_SECTION}>Two-Factor Authentication</div>
                <p className="text-sm text-muted-foreground">
                  {editingUser?.twofaEnabled
                    ? 'Enabled. Login requires an emailed code.'
                    : 'Off. Enabling sends a test code to the account email that must be entered here first. This proves the mailbox is real before 2FA can lock the account.'}
                </p>
                {editingUser?.twofaEnabled ? (
                  <button
                    onClick={handleTwofaDisable}
                    disabled={twofaBusy}
                    className="px-5 py-2.5 rounded-xl border border-[#FECDD3] bg-[#FFF1F2] text-sm font-semibold text-[#E11D48] hover:bg-[#FFE4E6] disabled:opacity-60 transition-colors"
                  >
                    Disable
                  </button>
                ) : twofaStep === 'idle' ? (
                  <button
                    onClick={handleTwofaInitiate}
                    disabled={twofaBusy}
                    className="px-5 py-2.5 rounded-xl border border-[#DCE3F5] bg-[#F4F7FF] text-sm font-semibold text-[#273A78] hover:bg-[#E8ECF6] disabled:opacity-60 transition-colors"
                  >
                    {twofaBusy ? 'Sending…' : 'Enable (send code)'}
                  </button>
                ) : null}
                {!editingUser?.twofaEnabled && twofaStep === 'code-sent' && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={twofaCode}
                      onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit code"
                      className="flex-1 px-4 py-2.5 text-sm text-[#475569] bg-[#F8FAFC] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#16214F]/30"
                      style={POPUP_FIELD_STYLE}
                    />
                    <button
                      onClick={handleTwofaConfirm}
                      disabled={twofaBusy || twofaCode.length !== 6}
                      className={POPUP_PRIMARY}
                    >
                      {twofaBusy ? 'Confirming…' : 'Confirm'}
                    </button>
                  </div>
                )}
                {twofaMessage && <p className="text-xs text-muted-foreground">{twofaMessage}</p>}
              </div>

              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
            <div className="flex justify-end gap-3 px-8 py-5 border-t border-border">
              <button
                onClick={() => setEditingUserId(null)}
                className={POPUP_CANCEL}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSubmitting}
                className={POPUP_PRIMARY}
              >
                {editSubmitting ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resettingUserId && (
        <Modal onClose={() => setResettingUserId(null)} maxWidth="max-w-lg" rounded="rounded-3xl" closeDisabled={resetSubmitting || sendingReset}>
            <PopupHeader title="Reset Password" subtitle={`for ${resettingUserName}`} onClose={() => setResettingUserId(null)} />
            <div className="px-8 py-6 space-y-5">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm text-foreground">Recommended — email {resettingUserName} a secure link so they set their own password (you never see it).</p>
                <button
                  onClick={handleSendResetLink}
                  disabled={sendingReset}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                >
                  <Mail className="w-4 h-4" /> {sendingReset ? 'Sending…' : 'Send reset email'}
                </button>
                {resetInfo && <p className="mt-2 text-sm text-green-700">{resetInfo}</p>}
              </div>
              {/* Sprint 93. Was text-gray-400 (#9ca3af): about 2.8:1 on white, which
                  FAILS WCAG AA for text (4.5:1). The token is ~4.7:1 and passes.
                  The two remaining gray-300s in AIAnalytics are decorative icons,
                  not text. */}
              <div className="text-center text-xs text-muted-foreground">or set a password directly (for accounts without a real mailbox)</div>
              <div>
                <label className={POPUP_LABEL}>New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className={POPUP_FIELD} style={POPUP_FIELD_STYLE}
                />
              </div>
              <div>
                <label className={POPUP_LABEL}>Confirm New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className={POPUP_FIELD} style={POPUP_FIELD_STYLE}
                />
              </div>
              <p className="text-xs text-muted-foreground">Share the new password with {resettingUserName} directly (in person, chat, or phone) — there's no automatic email notification.</p>
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            </div>
            <div className="flex justify-end gap-3 px-8 py-5 border-t border-border">
              <button
                onClick={() => setResettingUserId(null)}
                className={POPUP_CANCEL}
              >
                Cancel
              </button>
              <button
                onClick={handleResetPassword}
                disabled={resetSubmitting}
                className={POPUP_PRIMARY}
              >
                {resetSubmitting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmUser !== null}
        title={`Deactivate ${confirmUser?.name ?? 'account'}?`}
        message={
          <>
            They won't be able to log in until an admin reactivates the account.
            {confirmUser?.role === 'system_admin' && (
              <span className="mt-2 block font-medium text-destructive">
                This is a System Admin account — deactivating it removes access to user management, the audit trail, and archive restoration.
              </span>
            )}
          </>
        }
        confirmLabel="Deactivate"
        busy={deactivating}
        onConfirm={confirmDeactivate}
        onCancel={() => setConfirmUser(null)}
      />
    </div>
  );
};
