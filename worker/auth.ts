/**
 * Better Auth on Cloudflare: users, sessions and OAuth accounts live in D1 (native binding, no
 * ORM). One instance per isolate; the bindings are the same for every request it serves.
 */
import { betterAuth } from 'better-auth';
import { magicLink, username } from 'better-auth/plugins';
import type { Env } from './env.ts';
import { deliverInBackground, emailContext, sendEmail, signInDevice } from './emails.ts';

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
            },
          },
          databaseHooks: {
            user: {
              create: {
                after: async (user) => {
                  // Social providers and magic links can create an already-verified account.
                  if (user.emailVerified)
                    await deliverInBackground(sendEmail(env, 'welcome', user.email, { name: user.name, actionUrl: appURL() }, user.id));
                },
              },
              update: {
                after: async (user, context) => {
                  if (context?.path === '/magic-link/verify' && user.emailVerified)
                    await deliverInBackground(sendEmail(env, 'welcome', user.email, { name: user.name, actionUrl: appURL() }, user.id));
                },
              },
            },
            session: {
              create: {
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
      : {}),
    plugins: [
      // @handles for profiles: 3–30 characters, letters, numbers, dots and underscores.
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
      ...(mailEnabled
        ? [
            magicLink({
              expiresIn: 15 * 60,
              storeToken: 'hashed',
              sendMagicLink: async ({ email, url, token }) => {
                await deliverInBackground(sendEmail(env, 'magic-link', email, { actionUrl: url }, token));
              },
            }),
          ]
        : []),
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
