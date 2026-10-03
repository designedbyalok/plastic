/** Bindings and variables of the Plastic Worker (see wrangler.jsonc). */
import type { ProjectRoom } from './live.ts';

export interface Env {
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  /** Project files and images: users/<user id>/projects/<project id>/… */
  readonly FILES: R2Bucket;
  /** Live sync rooms, one per (user, project). */
  readonly ROOMS: DurableObjectNamespace<ProjectRoom>;
  /** Public origin of the app, e.g. https://plastic.example.com (http://localhost:8787 locally). */
  readonly BETTER_AUTH_URL: string;
  /** Secret: `bunx wrangler secret put BETTER_AUTH_SECRET` (locally in .dev.vars). */
  readonly BETTER_AUTH_SECRET: string;
  /** Sending-only Resend key, configured as a Worker secret. */
  readonly RESEND_API_KEY?: string;
  /** Comma-separated admin emails: they manage the waitlist and invites (see waitlist.ts). */
  readonly ADMIN_EMAILS?: string;
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
}
