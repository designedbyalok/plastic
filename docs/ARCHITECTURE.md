# Plastic architecture

Plastic is a visual editor for real interfaces. The design *is* HTML and CSS: the canvas shows
the browser rendering the actual markup, the inspector edits actual CSS declarations, and the
saved files are an ordinary web page that keeps working without Plastic.

Every decision below is checked against one question: does this move us toward a visual editor
for real interfaces, or toward recreating a proprietary graphics editor? When unsure, we pick the
web-native option.

---

## 1. Folder structure

```
src/
  document/        Pure design model. No React, no editor state. Usable from a CLI/MCP server.
    types.ts         DesignDocument, ElementNode, TextNode, StyleSheet
    tree.ts          Read-only queries (parent, ancestors, subtree, text content…)
    ops.ts           Pure edits: (doc, …) => doc
    table.ts         Table structure edits (rows/columns)
    factory.ts       NodeSpec templates → nodes + class rules
    css.ts           styles.css parser/serializer
    markup.ts        HTML rules shared by serializer and renderer (void tags, whitespace, ids)
  elements/        What the editor knows about HTML elements
    registry.ts      Friendly names, attribute schemas, swappable tags, layer naming
    insertables.ts   Insert templates (heading, input, labeled field, table…)
  serialization/   Files on disk ↔ DesignDocument
    html.ts          index.html
    project.ts       project.json (editor metadata only)
    index.ts         serializeProject / parseProject
    storage.ts       Workspace (list/create/open projects) and per-project storage
  editor/          Editor state and intents
    store.ts         Zustand store: document + history + editor state
    history.ts       Snapshot undo/redo with coalescing
    commands.ts      Intents that need live layout (wrap in stack, nudge, zoom…)
    persistence.ts   Autosave + external-change sync
    shortcuts.ts     Keyboard map
  canvas/          The spatial editing environment
    coords.ts        Document / world / screen coordinate math
    renderer.ts      Keyed doc → DOM reconciler
    ArtboardHost.tsx One iframe per artboard (a real viewport)
    dom.ts           id ↔ live element bridge, hit testing, measurement
    layout.ts        Questions answered by the browser's layout (flow insertion index…)
    gestures.ts      Pointer gestures (select, move, resize, marquee, insert, pan)
    Overlay.tsx      Screen-space selection, handles, guides
    textEditing.ts   Inline contenteditable text editing
  panels/          Toolbar, layers, inspector, code view
  home/            Home screen: the workspace's files, with live thumbnails
  app/             Routes (/ and /file/<id>), editor screen, editor chrome CSS
server/
  workspace.ts     Vite plugin: list/create/read/write/watch workspace/<id>/
tests/             Model, serialization, history and routing tests
workspace/         Your projects, one folder each (gitignored here; it is user data)
```

Dependency direction: `document` ← `elements` ← `serialization` ← `editor` ↔ `canvas` ← `panels`.
`document` and `serialization` never import from the editor or React.

## 2. Document model

```ts
interface DesignDocument {
  title: string;
  nodes: Record<NodeId, ElementNode | TextNode>; // flat map, immutable
  roots: NodeId[];                               // children of <body>, shown as artboards
  styles: StyleSheet;                            // styles.css
  frames: Record<NodeId, Point>;                 // artboard canvas positions → project.json
  names: Record<NodeId, string>;                 // custom layer names → project.json
}

interface ElementNode { kind: 'element'; id; tag; attrs; classes: string[]; children: NodeId[] }
interface TextNode    { kind: 'text'; id; text }
```

- **The tag is the semantic identity.** An input is `{ tag: 'input', attrs: { type: 'email' } }`,
  never "a rectangle with placeholder text". Friendly labels ("Email input", "Stack") are derived
  for display; they are not stored.
- **Text is a real child node**, so mixed content works exactly like the DOM:
  `<label>Email<input></label>` is `label → [text "Email", input]`.
- **Flat + immutable.** Nodes live in one map; edits replace only the changed objects. This makes
  snapshots cheap (undo), change detection trivial (`prev === next`), and the model easy for
  agents to address by id. Parents are derived (cached) rather than stored, so there is no
  second source of truth to keep in sync.
- **Three layers of information** stay separate, as the brief requires:
  - semantics: `tag` + semantic attributes (`type`, `name`, `for`, `scope`…)
  - presentation: CSS class rules
  - behavior: behavioral attributes (`required`, `disabled`, `readonly`, `checked`…). States
    like `:hover` / `:focus` / `:invalid` will be stored as CSS rules (`.button:hover`), not as
    editor concepts.

  The attribute *schemas* in `elements/registry.ts` tag each attribute with its group, so the
  inspector can present them separately while the document stores plain HTML attributes.

## 3. Editor-state model

`editor/store.ts` holds two clearly separated things:

| Design document (`doc`)                    | Editor state                                    |
| ------------------------------------------ | ----------------------------------------------- |
| Changed only via `apply()` / transactions  | Changed freely                                  |
| Undoable                                   | Never in history                                |
| Saved to index.html / styles.css (+frames, names in project.json) | Partly saved to project.json (viewport, collapsed layers) |
| Pure functions in `src/document`           | selection, hover, tool, viewport, text-editing id, panel toggles, save status |

Transient gesture visuals (marquee, drop line, ghost) live in a separate tiny store
(`canvas/gestureStore.ts`) so they never touch either.

## 4. Rendering architecture

```
Canvas (viewport, overflow hidden) ← receives every pointer event
├── World layer   transform: translate(x, y) scale(zoom)   ← the only place zoom is applied
│   └── ArtboardHost (position: absolute at frames[id])
│       └── <iframe> (pointer-events: none, sized to the root element)
│           └── standards-mode document
│               ├── <style>  editor guard rules (zero specificity)
│               ├── <style>  styles.css, verbatim
│               └── <body> → <div class="frame" data-pl-id>  ← the real design DOM
└── Overlay (screen space, pointer-events: none except handles/titles)
```

- **The browser renders the design.** `DomRenderer` is a small keyed reconciler from document
  nodes to real elements — the same tags, attributes and classes as the saved HTML. No React
  components per design element: the design is not React, and keeping React out of it means
  attribute names, whitespace and void elements match the file exactly.
- **One same-origin iframe per artboard.** Each artboard is a real browsing viewport whose size
  follows its root element (a `ResizeObserver` inside the iframe resizes the iframe to the root's
  box). So `@media` queries, viewport units, `@font-face`, `:root` variables and `body` rules
  behave exactly as in the exported page, and a 375px frame really is a 375px viewport. A root
  whose width depends on the viewport (`width: auto`) starts at a 1440px viewport.
  Iframes also isolate the design's CSS from the editor's in both directions.
- **One event path.** Iframes never receive pointer events (`pointer-events: none`), except the
  artboard currently being text-edited. The canvas gets every event and hit-tests into the
  iframe document (`elementsAtPoint` maps client → iframe coordinates using the measured
  scale). Gestures therefore never deal with events from several documents.
- **Crossing the boundary.** All measurement goes through `canvas/dom.ts`: `clientRectOf` maps an
  element's rect from iframe coordinates into the editor window, and `styleOf` reads computed
  style from the element's own window. Design nodes belong to another JS realm, so the canvas
  code never uses `instanceof` on them (it checks `nodeType`/`localName`).
- **Standards mode.** The iframe starts as `about:blank` (quirks mode), so it is rewritten once
  with `<!doctype html>` before the design is mounted.
- **Whitespace fidelity.** The serializer writes element-only children one per line; the renderer
  inserts a single collapsible space between those same children. Inline layouts therefore look
  identical in the editor and in the exported file.
- **The design is inert while editing.** Capture-phase listeners in each artboard document cancel
  focus, clicks, form submission and dragging. Event-handler attributes and `javascript:` URLs
  are kept in the document but never applied to the live DOM; `<script>` is not imported.

## 5. Selection architecture

- Selection is a list of node ids in editor state (multi-select supported).
- Hit testing: the deepest element with `data-pl-id` in the pointer event's composed path.
  Click selects it; Shift-click toggles; Enter steps into the first child, Esc/Shift+Enter
  steps out to the parent; a marquee on an artboard background (or empty canvas) selects
  the artboards' direct children.
- The overlay measures selected/hovered elements from the live DOM each animation frame
  (cheap: only a handful of rects) and draws them in screen space, so outlines stay 1px and
  handles keep their size at every zoom. A dashed outline shows the parent when it is a
  flex/grid container — the context that explains the element's position.

## 6. Pan/zoom architecture

Three coordinate spaces, never mixed (`canvas/coords.ts`):

| Space    | Unit                        | Who uses it                                   |
| -------- | --------------------------- | --------------------------------------------- |
| document | CSS px inside an artboard   | styles (`left: 120px`, `width: 240px`)        |
| world    | infinite canvas             | `frames[id]` (artboard placement)             |
| screen   | px inside the viewport      | pointer events, overlay                       |

`screen = world × zoom + (viewport.x, viewport.y)`, applied as one transform on the world layer.
Zooming never rewrites element styles — at 50% an element is still `width: 200px`. Gestures
convert pointer deltas with `delta / zoom` at the boundary; sizes come from
`getBoundingClientRect() / zoom` and are converted to the element's `box-sizing` before writing.

## 7. Undo/redo approach

- Every document change goes through `apply(label, recipe)` where `recipe` is a pure
  `(doc) => doc`. History stores **snapshots** of the previous document (plus selection), which
  is cheap because of structural sharing — simpler and more reliable than inverse operations.
- **Gestures are transactions**: `begin()` captures the base, each pointer move re-runs the edit
  from the base (`preview`), `commit()` records one entry. A whole drag is one undo step and
  Escape cancels it.
- **Coalescing**: edits with the same key within 1.2 s merge (typing in one inspector field is
  one step).
- Labels ("Set padding", "Wrap in stack") are kept for the UI and, later, for agent logs.
- External file changes (an agent or text editor) arrive as one undoable "External change".

## 8. Serialization strategy

A workspace is a folder of projects; a project is a plain folder:

```
workspace/demo/
├── index.html     the design: semantic markup, one data-pl-id per element
├── styles.css     the presentation: one rule per class, plus preserved rules
└── project.json   editor metadata only: artboard positions, layer names, viewport, collapsed layers
```

- **index.html is the source of truth** and is pretty-printed deterministically, so a change
  produces a minimal, readable diff. Saving twice without edits is byte-identical (tested).
- **`data-pl-id`** is the one editor attribute in the HTML. It keeps identity stable across
  saves so project.json can refer to elements. HTML without ids (hand-written, agent-written,
  copy-pasted) opens fine: missing and duplicate ids are regenerated. The code view can hide
  them for a clean export.
- **styles.css**: single-class rules are parsed into editable declarations; anything else
  (`:root` variables, `@media`, complex selectors) is preserved verbatim, **on the same side of
  the class rules as in the file**: `:root`/`@font-face` before them, `@media` overrides after
  them, so saving never changes the cascade. Comments are not yet preserved.
- **project.json is optional.** Deleting it loses only canvas placement and names; artboards
  without a stored position are laid out left to right.
- **Storage** is an interface (`serialization/storage.ts`): a `Workspace` lists, creates and
  opens projects; a `ProjectStorage` loads, saves and reports external edits for one project.
  In development the Vite plugin reads, writes and *watches* the workspace folder, so files
  edited by anything else stream back into the open editor and the home screen. Project ids
  are folder names restricted to `[a-z0-9_-]`, which keeps every path inside the workspace.
  A localStorage implementation is the fallback for static builds; Tauri will add a native one.
- **The file's name is its `<title>`.** The folder name is only an id (from the title at
  creation), so renaming a file never moves files on disk.
- **Thumbnails are the design.** The home screen renders each project's own HTML and CSS in a
  sandboxed iframe (no scripts), with artboards placed as on the canvas and the iframe viewport
  as wide as the artboards, so media queries apply. There are no image files to keep in sync.

## 9. How native HTML elements are represented

As themselves. The registry (`elements/registry.ts`) adds editor knowledge on top:

- a friendly label (`input[type=email]` → "Email input", `nav` → "Navigation"),
- an attribute schema per tag with control type and group (semantics / content / behavior),
  plus `when` conditions (`checked` only for checkbox/radio, `placeholder` only for text-like),
- whether it accepts children on the canvas and whether its text is directly editable,
- which tags it can be swapped with without restructuring (`div ↔ section ↔ form ↔ nav…`,
  `p ↔ h1…h6 ↔ label`, `th ↔ td`).

Unknown tags still work as generic elements. Composite insert templates produce the markup a
developer would write: "Labeled field" is `label > text + input`, "Checkbox" is
`label > input[type=checkbox] + text`, "Table" is `table > thead/tbody > tr > th[scope=col]/td`.

Layers show both: `Email  <label>`, `you@example.com  <input>`, `Continue  <button>`.

## 10. How CSS styles are stored and edited

- Each element has a **primary class** (its first class). The inspector reads and writes
  declarations on that class rule in `styles.css`. Inserted elements get a readable, unique
  class (`heading`, `button-2`, `login-form` after renaming). Elements without a class get one on
  their first style edit.
- **Classes may be shared** — that is CSS. Table cells share `.data-table-td`, so styling one cell
  styles them all, and the inspector says so ("3 share") with a one-click *Detach*. Duplicates
  get their own copies unless a class was already shared outside the copied subtree.
- **Controls map 1:1 to CSS properties** (`gap`, `flex-direction`, `grid-template-columns`,
  `padding`, `box-shadow`…), accept any CSS value, and show the browser's *computed* value as a
  placeholder. Arrow keys nudge numbers. The "CSS" section exposes every declaration of the
  class: the escape hatch to all of CSS.
- **"Auto layout" is flexbox.** Wrap in stack (⇧A) creates a `div` with
  `display:flex; flex-direction; gap`, infers direction and gap from the elements' positions, and
  removes their free positioning. **Free positioning** is `position:absolute; left; top` and is
  toggled per element (Layout ⇄ Free) without the element jumping.
- Multi-selection edits apply to each selected element's class.

## 11. Figma import (later)

The importer is a translator from Figma's node tree into `NodeSpec` trees — the same structure
insert templates use — so it needs no special path into the document:

| Figma                      | NodeSpec                                                        |
| -------------------------- | --------------------------------------------------------------- |
| Frame / Rectangle          | `div` (frames with children become containers)                  |
| Auto layout H / V          | `display:flex; flex-direction: row / column`                    |
| Item spacing / padding     | `gap` / `padding`                                               |
| Text                       | `p` (or `h1–h6` by style name / size heuristics, as a suggestion) |
| Image fill                 | `img` (or `background-image` for fills on frames)               |
| Vector / boolean / complex | exported SVG (`svg` subtree) or an `img` of the SVG            |
| Corner radius / effects    | `border-radius` / `box-shadow`, `filter`                        |
| Absolute children          | `position:absolute; left; top` inside a `position:relative` parent |
| Variables / styles         | CSS custom properties in the preserved part of styles.css       |

Priority: appearance first (fallback to SVG rather than failing), editability second, semantics
third. Semantic upgrades ("rectangle + placeholder text → input?", "repeated rows → table?") are
offered as **suggestions** that the user accepts; they run as ordinary document ops and are
undoable. Stable `data-pl-id`s let a later re-import map Figma node ids → Plastic ids in
project.json.

## 12. First milestone (this slice)

Implemented:

- Infinite canvas: pan (wheel, space-drag, middle-drag), zoom around the pointer (pinch / ⌘-wheel,
  ⌘±, ⇧0/⇧1/⇧2), dot grid.
- Artboards: draw with the Frame tool (F), move by their title, resize with handles.
- Real DOM elements: frame/container, heading, text, button, link, input, labeled field,
  textarea, select, checkbox, image, table, list.
- Selection, multi-selection (Shift-click, marquee), hover, handles, size badge, parent outline.
- Free positioning (drag rewrites `left/top`) and layout positioning (drag reorders inside and
  between flex/grid/block containers with an insertion indicator).
- Wrap in stack (⇧A) with inferred direction/gap; Layout ⇄ Free toggle.
- Semantic inspector (tag swap, attributes by group, select options, table rows/columns, image
  upload) and style inspector (position, layout, flex/grid child, size, spacing, appearance,
  text, raw CSS, raw attributes).
- Layers panel with friendly names + tags, collapse, rename.
- Inline text editing (double-click), undo/redo with transactions and coalescing,
  duplicate, delete, nudge.
- Code view (index.html / styles.css / project.json, with or without editor ids).
- Autosave to `workspace/<id>/`, reload from disk, live sync of external edits.
- Home screen: recent files with live thumbnails, search (⌘F), grid/list views, New file.

## Next steps (in priority order)

1. **Breakpoint editing**: show which `@media` rules apply to an artboard and edit them visually
   (today they are preserved and honored, but only editable as text).
2. **State styles**: `:hover`, `:focus-visible`, `:invalid`, `:disabled` as editable rules, with a
   state switcher on the canvas.
3. **CSS variables / basic tokens**: edit `:root` custom properties and bind controls to them.
4. **Agent API (MCP)**: expose `src/document/ops.ts` + queries over MCP. The document already
   has stable ids, semantic tags and pure operations; the API is mostly a thin transport.
5. **Components**: a class + markup template with slots, saved under `components/`, mapping to
   a React component later.
6. Accessibility checks built on the semantic model (inputs without labels, buttons without
   names, alt text, heading order, contrast).
7. Tauri packaging with native folder access; `assets/` folder instead of data URLs.
8. Figma import (section 11).

## Known limitations

- Content that overflows the root element (e.g. absolutely positioned children outside it) is
  clipped by the artboard's iframe.
- Clicking inside the artboard being text-edited, but outside the edited element, ends the
  edit without also selecting what was clicked.
- Only single-class rules are visually editable; other CSS is preserved but not editable in the
  inspector. CSS comments are dropped on save.
- Dragging a freely positioned element does not reparent it; use Layout mode or ⇧A.
- External edits made while a gesture is in progress are ignored until the next change on disk.
