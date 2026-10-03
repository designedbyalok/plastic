/**
 * Better Auth on Cloudflare: users, sessions and OAuth accounts live in D1 (native binding, no
 * ORM). One instance per isolate; the bindings are the same for every request it serves.
 */
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { customSession, magicLink, username } from 'better-auth/plugins';
import type { Env } from './env.ts';
import { deliverInBackground, emailContext, magicLinkCapture, sendEmail, signInDevice } from './emails.ts';
import { canCreateAccount, isAdmin } from './waitlist.ts';
import { sendReleaseNotes } from './releaseNotes.ts';
import { SUSPENDED_MESSAGE, isSuspended } from './suspensions.ts';

/** Names people could mistake for Plastic itself, or that clash with app routes. */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'plastic', 'useplastic', 'support', 'help', 'team', 'staff', 'official', 'security',
  'billing', 'api', 'www', 'root', 'system', 'settings', 'account', 'profile', 'about', 'login', 'signin', 'signup',
  'files', 'archive', 'file', 'changelog', 'download', 'mod', 'moderator', 'null', 'undefined', 'anonymous',
]);

/** Letters, numbers, dots and underscores; no dot at either end or two in a row; not reserved. */
export function validUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.]+$/.test(username) && !/^\.|\.$|\.\./.test(username) && !RESERVED_USERNAMES.has(username.toLowerCase());
}

/** Shown when someone without an invite tries to create an account (any sign-up method). */
export const INVITE_ONLY_MESSAGE = 'Plastic is invite-only for now. Join the waitlist at useplastic.app and we’ll email you an invite.';

export type Auth = ReturnType<typeof createAuth>;

/** Sign-in methods this deployment offers (social ones only when their secrets are set). */
export function providers(env: Env): string[] {
  const list = ['email'];
  if (env.RESEND_API_KEY) list.push('magic-link', 'password-reset');
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) list.push('github');
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.push('google');
  return list;
}

export function createAuth(env: Env) {
  const mailEnabled = Boolean(env.RESEND_API_KEY);
  const appURL = (path = '/') => new URL(path, env.BETTER_AUTH_URL).href;
  // Invite-only: every way of creating an account (email, magic link, Google, GitHub) creates a
  // user row, so the gate sits there. Existing accounts are never affected.
  // Suspended members: every sign-in creates a session, so refusing it here covers them all.
  const notSuspended = async (session: { userId: string }) => {
    if (await isSuspended(env, session.userId)) throw new APIError('FORBIDDEN', { message: SUSPENDED_MESSAGE, code: 'ACCOUNT_SUSPENDED' });
  };
  const inviteOnly = async (user: { email: string }) => {
    if (!(await canCreateAccount(env, user.email))) throw new APIError('FORBIDDEN', { message: INVITE_ONLY_MESSAGE, code: 'INVITE_ONLY' });
  };
  return betterAuth({
    appName: 'Plastic',
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: mailEnabled,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      ...(mailEnabled
        ? {
            sendResetPassword: async ({ user, url, token }) => {
              await deliverInBackground(sendEmail(env, 'password-reset', user.email, { name: user.name, actionUrl: url }, token));
            },
            onPasswordReset: async ({ user }) => {
              await deliverInBackground(
                sendEmail(
                  env,
                  'password-changed',
                  user.email,
                  {
                    name: user.name,
                    actionUrl: appURL('/?auth=sign-in'),
                    resetUrl: appURL('/?auth=forgot-password'),
                  },
                  crypto.randomUUID(),
                ),
              );
            },
          }
        : {}),
    },
    ...(mailEnabled
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: true,
            expiresIn: 24 * 60 * 60,
            sendVerificationEmail: async ({ user, url, token }) => {
              await deliverInBackground(sendEmail(env, 'verify-email', user.email, { name: user.name, actionUrl: url }, token));
            },
            afterEmailVerification: async (user) => {
              await deliverInBackground(sendEmail(env, 'welcome', user.email, { name: user.name, actionUrl: appURL() }, user.id));
              // New members also get the current release notes (once; they can unsubscribe).
              await sendReleaseNotes(env, user.email);
            },
          },
          databaseHooks: {
            user: {
              create: {
                before: inviteOnly,
                after: async (user) => {
                  // Social providers and magic links can create an already-verified account.
                  if (user.emailVerified) {
                    await deliverInBackground(sendEmail(env, 'welcome', user.email, { name: user.name, actionUrl: appURL() }, user.id));
                    await sendReleaseNotes(env, user.email);
                  }
                },
              },
              update: {
                after: async (user, context) => {
                  if (context?.path === '/magic-link/verify' && user.emailVerified) {
                    await deliverInBackground(sendEmail(env, 'welcome', user.email, { name: user.name, actionUrl: appURL() }, user.id));
                    await sendReleaseNotes(env, user.email);
                  }
                },
              },
            },
            session: {
              create: {
                before: notSuspended,
                after: async (session, context) => {
                  if (!context) return;
                  // Session refreshes must not cause another sign-in notification.
                  if (
                    !['/sign-in/email', '/sign-in/username', '/magic-link/verify'].includes(context.path) &&
                    !context.path.startsWith('/callback/')
                  )
                    return;
                  const user = await context.context.internalAdapter.findUserById(session.userId);
                  if (!user?.emailVerified) return;
                  await deliverInBackground(
                    sendEmail(
                      env,
                      'sign-in',
                      user.email,
                      {
                        name: user.name,
                        email: user.email,
                        device: signInDevice(session.userAgent),
                        time: session.createdAt
                          .toISOString()
                          .replace('T', ' ')
                          .replace(/\.\d+Z$/, ' UTC'),
                        actionUrl: appURL(),
                        resetUrl: appURL('/?auth=forgot-password'),
                      },
                      session.id,
                    ),
                  );
                },
              },
            },
          },
        }
      : { databaseHooks: { user: { create: { before: inviteOnly } }, session: { create: { before: notSuspended } } } }),
    plugins: [
      // @handles for profiles: 3–30 characters, letters, numbers, dots and underscores. Unique
      // regardless of case (the plugin compares lowercased names).
      username({ minUsernameLength: 3, maxUsernameLength: 30, usernameValidator: validUsername }),
      ...(mailEnabled
        ? [
            magicLink({
              expiresIn: 15 * 60,
              storeToken: 'hashed',
              sendMagicLink: async ({ email, url, token }) => {
                // An invite link is signing this person in directly: hand the link back, no email.
                const capture = magicLinkCapture.getStore();
                if (capture) {
                  capture.url = url;
                  return;
                }
                // A link for someone who can't have an account would be refused on arrival; don't
                // spend an email on it (the response stays the same, so nothing is revealed).
                const known = await env.DB.prepare('select id from "user" where email = ?').bind(email.toLowerCase()).first<{ id: string }>();
                if (!known && !(await canCreateAccount(env, email))) return;
                // Nor for a suspended account: the sign-in would be refused.
                if (known && (await isSuspended(env, known.id))) return;
                await deliverInBackground(sendEmail(env, 'magic-link', email, { actionUrl: url }, token));
              },
            }),
          ]
        : []),
      // Last, so the user already has the other plugins' fields. `admin` is computed from
      // ADMIN_EMAILS (no database read) and tells the app whether to show the waitlist.
      customSession(async ({ user, session }) => ({ user: { ...user, admin: isAdmin(env, user.email) }, session })),
    ],
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    session: {
      // Read live session state so password recovery immediately revokes previous sessions.
      // Deliberate: a lookup is ~2 indexed D1 row reads per API request, far inside the free
      // allowance, while any cookie cache would leave a revoked session working until it expires.
      cookieCache: { enabled: false },
    },
    advanced: {
      backgroundTasks: {
        handler: (task) => {
          emailContext.getStore()?.waitUntil(task);
        },
      },
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
