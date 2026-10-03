# Plastic

A visual editor for real interfaces. Designs are HTML and CSS — rendered by the browser, edited
visually, saved as plain files you own.

```html
<form class="login-form">
  <h2 class="heading">Sign in</h2>
  <label class="field">Email<input class="input" type="email" placeholder="you@example.com" required></label>
  <button class="button" type="submit">Continue</button>
</form>
```

That is what the editor saves — not a scene graph that has to be translated into code later.

## Run

```bash
bun install
bun run dev
```

Open the printed URL. The home screen lists the files in `workspace/`. Each file is a folder
(`workspace/<id>/`: one `.html` per page, `tokens.css`, `styles.css`, `project.json`) saved
continuously while you edit,
and opened at `/file/<id>`. Edit those files with anything — a text editor, git, a coding
agent — and the open editor and the home screen update (in the editor, as an undoable change).

Use a different workspace folder with `PLASTIC_WORKSPACE=path/to/folder bun run dev`.

```bash
bun run test       # model, serialization, history (Vitest; not `bun test`)
bun run typecheck
bun run build
```

## Try the first workflow

Tools are in the rail beside the layers panel; semantic elements (button, input, labeled
field, select, checkbox, table…) are in its **Insert element** menu, or on their shortcut.

1. **F**, then drag on the canvas: a frame (artboard).
2. **H**, click in the frame, type "Sign in", Enter.
3. **I** and click: an input. **B** and click: a button.
4. Drag a marquee over the three on the frame's background, press **⇧A**: they are wrapped in a
   vertical flex stack (direction and gap inferred).
5. In the inspector's **Layout** section change **Gap** and **Pad**; set **Tag** to `<form>`.
   Optional sections (Fill, Text, Border, Shadow…) stay collapsed until you press **+**.
6. Select the input: change **Type** to `email`, the **Placeholder**, tick **Required**.
7. Press **Code** (top of the inspector) to see the exact files being written.
8. Reload the page: everything comes back from disk.

Shortcuts are listed in the inspector when nothing is selected.

## Import from Figma

Drop a `.fig` file onto the home screen (in Figma: **File → Save local copy…**). Pages, frames,
auto layout, text, images, vectors and variables become plain HTML/CSS you can keep editing;
fonts you don't have installed are highlighted. Parsing uses [OpenPencil](https://github.com/open-pencil/open-pencil).

## Connect agents (MCP)

Claude, Codex, Cursor, GitHub Copilot and other local agents can read and write your designs
and tokens through Plastic's MCP server; their edits show up live in the editor. Deselect
everything and press **Connect more agents**, or see [docs/AGENTS.md](docs/AGENTS.md).

## File thumbnails and link previews

Select a frame on the canvas and choose **Use as Thumbnail** in the inspector. The saved
frame image becomes the file's dashboard cover and refreshes when its design changes.
**Update Thumbnail** recaptures it; **Remove Thumbnail** restores the default file cover.

For cloud files, copied file/frame links and the editor's address bar include a unique preview
identifier. Shared links show the saved thumbnail and **File Name • Plastic** in Open Graph
and Twitter previews. Only the preview image is public; editing still requires the owner's
account. Local files have dashboard covers but need cloud hosting for external link previews.

Apply `migrations/0006_project_previews.sql` with `bun run db:migrate:remote` before deploying
the preview feature. Sharing services may cache a previously fetched preview.

## Deploy (Cloudflare)

Plastic deploys to Cloudflare Workers only: the built app is served as static assets, and the
Worker in `worker/` handles `/api/*` and file-link preview metadata, with accounts using [Better Auth](https://better-auth.com),
stored in D1. Local `bun run dev` has no accounts; files stay in `workspace/`.

```bash
bun run cf:dev             # build and run the Worker locally (local D1; secrets in .dev.vars)
bun run db:migrate:local   # apply migrations/ to the local D1
bun run db:migrate:remote  # apply migrations/ to the production D1
bun run deploy             # build and deploy
```

Set the auth secret once with `openssl rand -hex 32 | bunx wrangler secret put BETTER_AUTH_SECRET`,
The app is served on https://useplastic.app (`routes` and `BETTER_AUTH_URL` in `wrangler.jsonc`; `.dev.vars` sets `BETTER_AUTH_URL=http://localhost:8787` for `wrangler dev`). GitHub/Google sign-in turn on when
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (or the `GOOGLE_` pair) are set as secrets.

## Docs

- [Agents (MCP)](docs/AGENTS.md) — connecting coding agents, and the tools they get.
- [Architecture](docs/ARCHITECTURE.md) — document model, rendering, coordinates, undo,
  serialization, and what comes next.
