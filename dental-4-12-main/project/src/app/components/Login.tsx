import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Tag } from './public/PublicLayout';
import { apiClient, ApiError } from '../api/client';
import { Notice } from './Notice';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

type Step = 'credentials' | 'otp' | 'forgot' | 'forgot-sent';

export const Login = () => {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Fields stay read-only until clicked, so the browser does not fill saved credentials
  // when the page loads. Clicking a field makes it editable and the browser offers them.
  const [armed, setArmed] = useState(false);
  // Defaults to off: clinic PCs are shared, so a session that ends with the
  // browser is the safer default. Ticking it restores the 7-day cookie.
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useOfflineQueue();
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(email, password, remember);
    setSubmitting(false);
    if (result.ok) {
      navigate('/');
    } else if (result.twofaRequired) {
      setStep('otp');
      setCode('');
      setResendCooldown(60);
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await verifyOtp(email, code, remember);
    setSubmitting(false);
    if (result.ok) {
      navigate('/');
    } else {
      setError(result.error || 'Verification failed');
    }
  };

  // Re-running login re-checks the password and emails a fresh code
  const handleResend = async () => {
    setError(null);
    setResendCooldown(60);
    const result = await login(email, password, remember);
    if (!result.twofaRequired && !result.ok) {
      setError(result.error || 'Could not resend the code');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setStep('forgot-sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No connection. Try again when back online.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToSignIn = () => {
    setStep('credentials');
    setError(null);
    setCode('');
  };

  // Night Clinic sign-in, matching the public pages. Fields carry `field-dark` so the
  // app-wide field border/focus rule in index.css does not turn them light-on-dark.
  const fieldClass = 'field-dark h-11 w-full rounded-xl bg-black/25 px-3.5 text-sm text-white placeholder:text-white/45';
  const labelClass = 'mb-1.5 block text-[13px] font-semibold text-white';
  const primaryBtn = 'mt-1 h-12 w-full rounded-xl bg-sky-400 text-sm font-bold text-[#06204A] transition hover:brightness-110 disabled:opacity-60';
  const linkBtn = 'text-xs font-normal text-sky-300 hover:underline';

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-10 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="hidden lg:block">
        <Tag>Welcome to Floral!</Tag>
        <h1 className="mt-4 text-balance text-[clamp(2.4rem,4.6vw,4rem)] font-extrabold leading-[1] tracking-tight">Your school dental clinic’s records, ready when you are.</h1>
        <p className="mt-4 max-w-[46ch] text-lg text-blue-100/85">Sign in to see your students, schedules and reports.</p>
      </div>

      <div className="w-full">
        {/* Signing in is the one action that cannot work offline: it needs the server to
            issue a token, so a failed attempt would otherwise read as a wrong password. */}
        {!isOnline && (
          <div className="mb-3">
            <Notice variant="warning">You're offline. Signing in needs a connection. Reconnect and try again.</Notice>
          </div>
        )}

        <div className="rounded-3xl border border-white/20 bg-white/[0.09] p-7 shadow-[0_25px_80px_rgba(0,0,30,0.4)] backdrop-blur-xl sm:px-7 sm:py-12">
          <div className="mb-6 flex items-center gap-3">
            <img src="/logo.svg" alt="" aria-hidden="true" className="h-9 w-9 object-contain" />
            <span className="text-lg font-extrabold">Floral</span>
          </div>

          {step === 'credentials' && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-2xl font-extrabold tracking-tight">Welcome back!</h2>
              <p className="text-sm text-blue-100/80">Use your clinic email and password.</p>

              <div className="mt-7">
                <label htmlFor="login-email" className={labelClass}>Email</label>
                {/* autoComplete hands sign-in autofill to the BROWSER's own credential
                    manager. The app stores nothing itself: a password in localStorage would
                    undo Sprint 37 and is an OWASP finding waiting to happen. */}
                <input id="login-email" type="email" name="email" autoComplete="username" value={email}
                  readOnly={!armed} onFocus={() => setArmed(true)}
                  onChange={(e) => setEmail(e.target.value)} className={fieldClass} placeholder="Enter your email" required />
              </div>

              <div className="mt-6">
                <label htmlFor="login-password" className={labelClass}>Password</label>
                <div className="relative">
                  <input id="login-password" type={showPassword ? 'text' : 'password'} name="password" autoComplete="current-password"
                    value={password} readOnly={!armed} onFocus={() => setArmed(true)} onChange={(e) => setPassword(e.target.value)} className={`${fieldClass} pr-11`} placeholder="Enter your password" required />
                  {password && (
                    <button type="button" onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:text-white"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-8 mt-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs font-normal text-blue-100/85">
                <label htmlFor="login-remember" className="flex cursor-pointer items-center gap-2 text-xs font-normal">
                  <input id="login-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-sky-400" />
                  Remember Me
                </label>
                <button type="button" onClick={() => { setStep('forgot'); setError(null); }} className={linkBtn}>Forgot password?</button>
              </div>

              {error && <Notice variant="error" className="mb-3">{error}</Notice>}

              <button type="submit" disabled={submitting} className={primaryBtn}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <h2 className="text-2xl font-extrabold tracking-tight">Verify it's you</h2>
              <div className="flex items-start gap-2 rounded-xl border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-xs text-blue-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>A 6-digit verification code was emailed to <strong>{email}</strong>. It expires in 10 minutes.</span>
              </div>
              <div>
                <label htmlFor="login-otp" className={labelClass}>Verification code</label>
                <input id="login-otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={`${fieldClass} text-center text-xl font-semibold tracking-[0.4em]`} placeholder="••••••" autoFocus required />
              </div>

              {error && <Notice variant="error">{error}</Notice>}

              <button type="submit" disabled={submitting || code.length !== 6} className={primaryBtn}>{submitting ? 'Verifying…' : 'Verify and sign in'}</button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={backToSignIn} className="flex items-center gap-1 text-white/75 hover:text-white">
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </button>
                <button type="button" onClick={handleResend} disabled={resendCooldown > 0} className={`${linkBtn} disabled:text-white/45 disabled:no-underline`}>
                  {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <h2 className="text-2xl font-extrabold tracking-tight">Reset your password</h2>
              <p className="text-sm text-blue-100/80">
                Enter your account email. If it has a real mailbox on file, you'll receive a reset link. No email set up? Contact your System Admin instead.
              </p>
              <div>
                <label htmlFor="forgot-email" className={labelClass}>Email</label>
                <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} placeholder="Enter your email" autoFocus required />
              </div>

              {error && <Notice variant="error">{error}</Notice>}

              <button type="submit" disabled={submitting} className={primaryBtn}>{submitting ? 'Sending…' : 'Send reset link'}</button>
              <button type="button" onClick={backToSignIn} className="flex items-center gap-1 text-xs text-white/75 hover:text-white">
                <ArrowLeft className="h-3 w-3" /> Back to sign in
              </button>
            </form>
          )}

          {step === 'forgot-sent' && (
            <div className="space-y-4">
              <Notice variant="success">
                If that email has an account, a reset link is on its way. The link expires in 30 minutes. Check spam if it doesn't arrive.
              </Notice>
              <button type="button" onClick={backToSignIn} className="flex items-center gap-1 text-xs text-white/75 hover:text-white">
                <ArrowLeft className="h-3 w-3" /> Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
