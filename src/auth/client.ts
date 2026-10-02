/**
 * Accounts. A deployed Plastic (the Cloudflare Worker) has Better Auth at /api/auth and requires
 * sign-in; the local dev server has no accounts — your files are on your disk.
 */
import { createAuthClient } from 'better-auth/react';
import { usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  // The session cookie is long-lived; re-checking it on every window focus is a request for nothing.
  sessionOptions: { refetchOnWindowFocus: false },
  plugins: [usernameClient()],
});

export interface Backend {
  /** Whether this deployment has accounts. */
  readonly auth: boolean;
  /** Sign-in methods offered: "email", "github", "google". */
  readonly providers: readonly string[];
}

let backend: Promise<Backend> | null = null;

/** Ask the Worker what it supports; anything else (dev server, static host) has no accounts. */
export function detectBackend(): Promise<Backend> {
  backend ??= fetch('/api/health', { headers: { accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) return { auth: false, providers: [] };
      const data = (await r.json()) as Partial<Backend>;
      return { auth: data.auth === true, providers: Array.isArray(data.providers) ? data.providers : [] };
    })
    .catch(() => ({ auth: false, providers: [] }));
  return backend;
}
