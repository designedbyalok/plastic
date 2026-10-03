/** Password, verified signup, password reset and passwordless sign-in. */
import { Loader2 } from 'lucide-react';
import { Logo } from '../app/Logo.tsx';
import { useState, type FormEvent } from 'react';
import { authClient } from './client.ts';
import './auth.css';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password' | 'magic-link';
const titles: Record<Mode, string> = {
  'sign-in': 'Sign In to Plastic',
  'sign-up': 'Create Your Plastic Account',
  'forgot-password': 'Reset Your Password',
  'reset-password': 'Choose a New Password',
  'magic-link': 'Sign In with a Magic Link',
};
const buttons: Record<Mode, string> = {
  'sign-in': 'Sign In',
  'sign-up': 'Create Account',
  'forgot-password': 'Send Reset Link',
  'reset-password': 'Save New Password',
  'magic-link': 'Send Magic Link',
};
export function SignIn({ providers }: { providers: readonly string[] }) {
  const query = new URLSearchParams(location.search);
  const initialMode = query.get('auth');
  const [mode, setMode] = useState<Mode>(
    initialMode === 'reset-password'
      ? 'reset-password'
      : initialMode === 'forgot-password' && providers.includes('password-reset')
        ? 'forgot-password'
        : 'sign-in',
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(
    query.has('error') ? 'This link has expired or is invalid. Request a new one below.' : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const social = providers.filter((p) => p === 'github' || p === 'google') as ('github' | 'google')[];
  const mailEnabled = providers.includes('magic-link');
  const callbackURL = new URL(location.pathname, location.origin).href;
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setVerify(false);
    setPassword('');
    setConfirmation('');
    if (query.has('token') || query.has('auth') || query.has('error')) history.replaceState(null, '', location.pathname);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'reset-password' && password !== confirmation) {
        setError('The passwords do not match.');
        return;
      }
      if (mode === 'reset-password' && !query.get('token')) {
        setError('This reset link is invalid. Request a new one.');
        return;
      }
      const result =
        mode === 'sign-up'
          ? await authClient.signUp.email({
              name: name.trim() || email.split('@')[0]!,
              email,
              password,
              callbackURL,
            })
          : mode === 'forgot-password'
            ? await authClient.requestPasswordReset({
                email,
                redirectTo: new URL('/?auth=reset-password', location.origin).href,
              })
            : mode === 'reset-password'
              ? await authClient.resetPassword({
                  newPassword: password,
                  token: query.get('token')!,
                })
              : mode === 'magic-link'
                ? await authClient.signIn.magicLink({
                    email,
                    callbackURL,
                    errorCallbackURL: new URL('/?auth=sign-in', location.origin).href,
                  })
                : await authClient.signIn.email({
                    email,
                    password,
                    callbackURL,
                  });
      if (result.error) {
        if (result.error.code === 'EMAIL_NOT_VERIFIED') {
          setVerify(true);
          setNotice('Check your inbox to verify your email before signing in.');
        } else setError(result.error.message ?? 'Something went wrong. Try again.');
      } else if (mode === 'sign-up' && mailEnabled) {
        setVerify(true);
        setNotice('Check your inbox to verify your email and open your workspace.');
      } else if (mode === 'forgot-password') setNotice('If an account exists for this email, a password-reset link is on its way.');
      else if (mode === 'magic-link') setNotice('Check your inbox for your sign-in link. It expires in 15 minutes.');
      else if (mode === 'reset-password') {
        history.replaceState(null, '', location.pathname);
        setMode('sign-in');
        setPassword('');
        setConfirmation('');
        setNotice('Your password has been changed. Sign in with your new password.');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL,
      });
      if (result.error) setError(result.error.message ?? 'Unable to send the verification email.');
      else setNotice('A verification link is on its way. Check your inbox.');
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const continueWith = async (provider: 'github' | 'google') => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider, callbackURL });
      if (result.error) {
        setBusy(false);
        setError(result.error.message ?? 'Something went wrong. Try again.');
      }
    } catch {
      setBusy(false);
      setError('Unable to connect. Please try again.');
    }
  };
  const passwordMode = mode === 'sign-in' || mode === 'sign-up' || mode === 'reset-password';
  return (
    <div className="auth">
      <main className="auth-card">
        <div className="auth-mark" aria-hidden="true">
          <Logo size={40} />
        </div>
        <h1 className="auth-title">{titles[mode]}</h1>
        <p className="auth-subtitle">{mode === 'magic-link' ? 'One secure link. No password.' : 'Design with real HTML and CSS.'}</p>
        {(mode === 'sign-in' || mode === 'sign-up') && social.length > 0 && (
          <>
            <div className="auth-social">
              {social.map((provider) => (
                <button key={provider} type="button" className="auth-button" disabled={busy} onClick={() => void continueWith(provider)}>
                  Continue with {provider === 'github' ? 'GitHub' : 'Google'}
                </button>
              ))}
            </div>
            <div className="auth-or">
              <span>or</span>
            </div>
          </>
        )}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode === 'sign-up' && (
            <label className="auth-field">
              <span>Name</span>
              <input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          {mode !== 'reset-password' && (
            <label className="auth-field">
              <span>Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
          )}
          {passwordMode && (
            <label className="auth-field">
              <span>{mode === 'reset-password' ? 'New Password' : 'Password'}</span>
              <input
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {mode === 'reset-password' && (
            <label className="auth-field">
              <span>Confirm Password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          )}
          {mode === 'sign-in' && providers.includes('password-reset') && (
            <button className="auth-text-button" type="button" disabled={busy} onClick={() => switchMode('forgot-password')}>
              Forgot password?
            </button>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
          <button type="submit" className="auth-button is-primary" disabled={busy}>
            {busy && <Loader2 size={14} strokeWidth={2} className="auth-spin" />}
            {buttons[mode]}
          </button>
          {verify && (
            <button className="auth-button" type="button" disabled={busy} onClick={() => void resend()}>
              Resend Verification Email
            </button>
          )}
          {mode === 'sign-in' && mailEnabled && (
            <button className="auth-button" type="button" disabled={busy} onClick={() => switchMode('magic-link')}>
              Use a Magic Link
            </button>
          )}
        </form>
        <p className="auth-switch">
          {mode === 'sign-in' ? (
            <>
              New to Plastic?{' '}
              <button type="button" disabled={busy} onClick={() => switchMode('sign-up')}>
                Create an Account
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => switchMode('sign-in')}>
              Back to Sign In
            </button>
          )}
        </p>
        {mode === 'reset-password' && (
          <p className="auth-switch">
            <button type="button" disabled={busy} onClick={() => switchMode('forgot-password')}>
              Request a New Reset Link
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
