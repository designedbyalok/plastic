/** Sign in or create an account (email and password, plus GitHub/Google when configured). */
import { Loader2 } from 'lucide-react';
import { Logo } from '../app/Logo.tsx';
import { useState, type FormEvent } from 'react';
import { authClient } from './client.ts';
import './auth.css';

type Mode = 'sign-in' | 'sign-up';

export function SignIn({ providers }: { providers: readonly string[] }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const social = providers.filter((p) => p === 'github' || p === 'google') as ('github' | 'google')[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({ name: name.trim() || email.split('@')[0]!, email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) setError(result.error.message ?? 'Something went wrong. Try again.');
  };

  const continueWith = async (provider: 'github' | 'google') => {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.social({ provider, callbackURL: location.pathname });
    if (result.error) {
      setBusy(false);
      setError(result.error.message ?? 'Something went wrong. Try again.');
    }
  };

  return (
    <div className="auth">
      <main className="auth-card">
        <div className="auth-mark" aria-hidden="true">
          <Logo size={40} />
        </div>
        <h1 className="auth-title">{mode === 'sign-in' ? 'Sign in to Plastic' : 'Create your Plastic account'}</h1>
        <p className="auth-subtitle">Design with real HTML and CSS.</p>

        {social.length > 0 && (
          <>
            <div className="auth-social">
              {social.map((p) => (
                <button key={p} type="button" className="auth-button" disabled={busy} onClick={() => void continueWith(p)}>
                  Continue with {p === 'github' ? 'GitHub' : 'Google'}
                </button>
              ))}
            </div>
            <div className="auth-or">
              <span>or</span>
            </div>
          </>
        )}

        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          {mode === 'sign-up' && (
            <label className="auth-field">
              <span>Name</span>
              <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="auth-button is-primary" disabled={busy}>
            {busy && <Loader2 size={14} strokeWidth={2} className="auth-spin" />}
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'sign-in' ? 'New to Plastic?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }}
          >
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </main>
    </div>
  );
}
