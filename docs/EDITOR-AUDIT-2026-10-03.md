# Editor Tool and Control Audit — October 3, 2026

Reviewed the tool rail, keyboard dispatch, canvas gestures, layer moves, inspector sections,
shared fields/menus, code editor, font loading, and document serialization. Verification combines
an in-memory browser fixture with the full regression suite. It does not modify user projects.

## Findings Fixed

- The app UI used system-ui rather than Inter. It now loads the bundled Inter variable face
  locally, with weight range 100–900 and Unicode subsets fetched as needed.
- Non-text insert tools inherited unspecified typography. All semantic insert tools, frames,
  and shape/vector roots now default to Inter. Newly inserted semantic elements and frames
  register the font in design CSS, so an Inter declaration does not silently use a fallback.
- Imported `Inter Regular`, `Inter Medium`, and `Inter Variable` names were separate unavailable
  families. Project loading and clipboard import now normalize these to Inter with numeric
  weights, including font tokens. Regular maps to 400 and Medium maps to 500. Explicit other
  weights and project-defined custom font faces remain respected.
- Project opening loads the bundled design face before normalizing Inter. A startup Google
  Fonts fallback can be replaced with the local, exportable face once it is available. Other
  Google Fonts remain loaded on selection.
- Bare HTML pasted onto the canvas now receives Inter when it has no explicit font declaration.
- Pending image-fill reads are cancelled on fill changes or unmount, and a superseded read
  cannot overwrite the newer selection. A regression test exercises the late callback.

Existing intentionally selected fonts remain intact. Code surfaces retain their monospace font.

## Browser Coverage

Open `/tests/browser/controls.html` with the Vite development server and press **Run Tool and
Control Audit**. This fixture renders the real canvas, tool rail, layers, inspector, and code
panel using an in-memory document. It drives DOM events and checks browser-rendered CSS and
loaded FontFace objects, rather than treating a successful button click as proof.

| Group | Checks |
| --- | --- |
| Fonts | Local Inter variable face loaded; Regular 400 and Medium 500; correct inspector selection |
| Tool Rail | Select, Hand, Frame, Pen, Container, Text, Heading, Image activation; nested frame creation |
| Shapes | Rectangle, Ellipse, Line, Arrow, Polygon, Star creation, rendering and undo |
| Semantic Insert | Every non-text insert template renders with Inter, including form controls, table and list |
| Text | Empty caret cancellation, typed text, Fit width, inline edit commit |
| Typography and Fill | Weight menu, font size and text fill update rendered CSS |
| Box Controls | Width, height, rotation, both flips, radius, opacity, undo/redo |
| Pen | New path and vector drawing mode |
| Canvas Navigation | Hand pan, rulers, keyboard undo |
| Code | CSS tab editing through CodeMirror updates the canvas |
| Organization | Component creation, page creation and undo |
| Sizing | Fit, Fill, Relative and Fixed menus; min/max fields |
| Table | Add/remove rows and columns |
| Flex and Effects | Flex, alignment, gap, padding, clipping, border/shadow add/remove |
| Serialization | Saved/reloaded font weights remain correct |

## Regression Coverage

`bun run test` passes all **274 tests in 48 files**. The suite also covers layer nesting and
reordering, frame links, clipboard cut/paste, auto-layout wrapping, absolute alignment, sizing,
vector points and booleans, gradients, tokens, responsive/state CSS, components, renderer safety,
image loading, persistence/concurrent changes, thumbnails, menus, and server operations.

`bun run build` passes TypeScript checks, Vite production bundling and the public-site build.
`git diff --check` passes.

## Limits

This is representative workflow coverage plus code review of the control groups, not a claim
that every CSS combination, imported design, browser, or accessibility interaction is exhaustively
tested. The browser fixture verifies serialization without contacting workspace storage. Actual
cloud account actions, external agent clients, clipboard permissions, and the browser eyedropper
were not exercised against a live account in this pass; their existing tests remain passing.
