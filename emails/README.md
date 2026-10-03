# Plastic email templates

Approved October 3, 2026. Sender: **Plastic <hello@useplastic.app>**.
Seven published templates are available in Resend. Their IDs and aliases are recorded in
`resend-templates.json`. Release notes are a reusable template; no broadcast has been sent.

The editable Plastic file is `workspace/plastic-email-templates`, available at
`/file/plastic-email-templates` on the workspace-enabled dev server. It has seven pages,
each with desktop (640 px) and mobile (360 px) artboards. `emails/design` holds the approved
versioned snapshot, including the Lucide ArrowUpRight CTA icon.

## Updating designs

After reviewing changes in Plastic, copy the workspace HTML, CSS, tokens and assets into
`emails/design`. `bun run emails:build` compiles the exact desktop frames in `manifest.json`
into `worker/generated/email-templates.ts`. It inlines CSS, resolves design tokens, replaces
example recipient values with delivery fields, adds a hidden preheader and generates plain
text. Responsive rules match the mobile artboards. The Lucide SVG uses light/dark 4x PNG variants in
outgoing emails for clients that do not display inline SVG. `delivery.css` switches the icon
and CTA colors in dark mode, including Outlook selectors. Contrasting outlines keep the
icon visible in clients that recolor buttons without supporting image swaps. Assets are
served from `/emails/`.

`node scripts/publish-email-templates.mjs` synchronizes and publishes the same designs in
Resend through the authenticated official CLI. It updates known template IDs. Template
variables are prefixed `PLASTIC_` to avoid reserved Resend names. This command sends no emails.

The Worker sends compiled HTML and plain text directly to Resend, with escaped recipient
values, origin-validated authentication links, idempotency keys and retries for transient
errors. The native Plastic file and its versioned snapshot remain the design source.

## Workflows

- Sign-up sends verification. Successful verification signs in the user and sends welcome.
  Existing unverified accounts receive a verification link when attempting password sign-in.
- A successful password, magic-link or social sign-in sends a notification with browser,
  operating system and timestamp in UTC. Failed sign-ins and session refreshes do not.
- Forgot password sends a single-use reset link. Successful reset revokes prior sessions and
  sends password-changed confirmation. The reset form works in a signed-in browser too.
- Magic links verify email ownership and sign in, or create an account, without a password.
- Release notes require a real unsubscribe URL when rendered with `renderEmail`/`sendEmail`.
  Select opted-in recipients before sending a release announcement.

Verification expires after 24 hours; password-reset links after 1 hour; magic links after
15 minutes. Better Auth stores magic-link tokens hashed and consumes them atomically.

## Configuration and validation

`RESEND_API_KEY` is a domain-scoped sending-only secret in Cloudflare and in ignored
`.dev.vars`. Authentication mail features are advertised only when the secret is present.
`ExecutionContext.waitUntil` keeps delivery alive after Worker responses. Resend failures
are logged without recipient data or authentication links.

`bun run test tests/auth-emails.test.ts` exercises the real Better Auth endpoints against
SQLite with mocked email transport. It checks verification, welcome, sign-in notifications,
password reset, session revocation, hashed single-use magic links and safe template rendering.
`bun run build` rebuilds templates and type-checks the app, server and Worker.
