/**
 * Better Auth on Cloudflare: users, sessions and OAuth accounts live in D1 (native binding, no
 * ORM). One instance per isolate; the bindings are the same for every request it serves.
 */
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import type { Env } from './env.ts';

export type Auth = ReturnType<typeof createAuth>;

/** Sign-in methods this deployment offers (social ones only when their secrets are set). */
export function providers(env: Env): string[] {
  const list = ['email'];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) list.push('github');
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push('google');
  return list;
}

export function createAuth(env: Env) {
  return betterAuth({
    appName: 'Plastic',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // No email provider yet; turn this on once verification emails can be sent.
      requireEmailVerification: false,
    },
    plugins: [
      // @handles for profiles: 3–30 characters, letters, numbers, dots and underscores.
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
    ],
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
    },
    session: {
      // Re-validate against D1 at most every 15 minutes; the signed cookie covers the rest, so
      // most API calls need no database read for auth.
      cookieCache: { enabled: true, maxAge: 15 * 60 },
    },
    advanced: {
      // Workers see the client IP in this header.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
  });
}

let cached: { env: Env; auth: Auth } | null = null;

export function getAuth(env: Env): Auth {
  if (cached?.env !== env) cached = { env, auth: createAuth(env) };
  return cached.auth;
}
