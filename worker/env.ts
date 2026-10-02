/** Bindings and variables of the Plastic Worker (see wrangler.jsonc). */
export interface Env {
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  /** Project files and images: users/<user id>/projects/<project id>/… */
  readonly FILES: R2Bucket;
  /** Public origin of the app, e.g. https://plastic.example.com (http://localhost:8787 locally). */
  readonly BETTER_AUTH_URL: string;
  /** Secret: `bunx wrangler secret put BETTER_AUTH_SECRET` (locally in .dev.vars). */
  readonly BETTER_AUTH_SECRET: string;
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
}
