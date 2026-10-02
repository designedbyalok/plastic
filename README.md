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

## Connect agents (MCP)

Claude, Codex, Cursor, GitHub Copilot and other local agents can read and write your designs
and tokens through Plastic's MCP server; their edits show up live in the editor. Deselect
everything and press **Connect more agents**, or see [docs/AGENTS.md](docs/AGENTS.md).

## Docs

- [Agents (MCP)](docs/AGENTS.md) — connecting coding agents, and the tools they get.
- [Architecture](docs/ARCHITECTURE.md) — document model, rendering, coordinates, undo,
  serialization, and what comes next.
