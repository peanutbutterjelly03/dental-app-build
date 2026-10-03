import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import { Notice } from './Notice';

// Landing page for the emailed reset link (/reset-password?token=...).
// Public route — the token IS the authentication.
export const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No connection — try again when back online.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-transparent text-sm';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          <h1 className="text-2xl font-bold text-[#1E40AF] mb-1">FLORAL</h1>
          <p className="text-sm text-muted-foreground">Dental Health Record Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-5 border border-gray-100">
          {!token ? (
            <div className="space-y-4">
              <Notice variant="error">This reset link is malformed or incomplete. Request a new one from the login page.</Notice>
              <Link to="/login" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-3 h-3" /> Back to sign in
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-4">
              <Notice variant="success">
                Password updated. You can sign in with your new password now.
              </Notice>
              <Link to="/login" className="block w-full text-center bg-[#1E40AF] hover:bg-blue-700 text-white font-medium py-2 rounded-lg text-sm">
                Go to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Both password fields below use autoComplete="new-password",
                  never "current-password": Login gained autoComplete on
                  2026-09-02, so browsers now save credentials — and without
                  this token they would offer the OLD password into the very
                  field whose purpose is replacing it. */}
              <p className="text-sm text-foreground font-medium">Set a new password</p>
              <div>
                <label htmlFor="reset-password" className="block text-sm font-medium text-foreground mb-1">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                    placeholder="At least 8 characters"
                    minLength={8}
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="reset-confirm" className="block text-sm font-medium text-foreground mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    id="reset-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                    minLength={8}
                    required
                  />
                </div>
              </div>

              {error && <Notice variant="error">{error}</Notice>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[#1E40AF] hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 rounded-lg transition-colors text-sm"
              >
                {submitting ? 'Saving…' : 'Set New Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
