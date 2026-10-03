# Plastic improvement plan

Preserve the existing semantic HTML/CSS model, vector editing, Figma import,
code editor, tokens, pages, undo/redo, local files, cloud accounts, and MCP tools.

## Reliability and compatibility (first implementation)

- [x] Replace the handwritten CSS parser with MIT-licensed PostCSS and its safe parser. Cache serialization by immutable sheet identity.
  Preserve source order, comments, fallback declarations, importance, nested rules,
  media queries and token overrides; edit only the declarations that changed.
- [x] Use the PostCSS selector parser for class renaming, including pseudo states
  and selectors inside media queries. Keep MCP CSS insertion ordered.
- [x] Sandbox artboards and downloaded HTML while retaining editor DOM access and
  rendering supported elements. Verify nested iframe scripts cannot reach the editor.
- [x] Serialize saves per project, isolate project lifetimes, queue external changes
  during gestures/text editing and automatically merge independent changes within files.
  Resolve overlapping values in favor of active unsaved edits without prompting.
- [x] Write immutable cloud revisions, validate manifests and use optimistic concurrency.
  Keep legacy projects readable; old URLs must never cache newer bytes as old versions.
- [x] Add regression tests for these paths and run all existing tests and a build.

- [x] Avoid DOM reconciliation for unchanged artboards; retain browser layout, CSS animations
  and explicit rerender invalidation.
- [x] Surface file-load failures with retry actions instead of accepting partial projects.

## Further product work

- [x] Canvas selection reveals collapsed ancestors and smoothly anchors the active layer.
  Panel scrollbars overlay content without a gutter and fade out after scrolling.
- [x] Stable frame deep links with automatic selection/zoom, inline canvas-title renaming,
  and complete frame source for AI via `get_frame` MCP and portable AI-context copy.
  Local frame URLs require workspace access; public cloud share links are not implemented.
- [x] First visual breakpoint/state editor: presets and custom max-width breakpoints;
  default, hover, focus, focus-visible, active and disabled states. Add/edit/remove ordinary
  CSS declarations in a dedicated inspector section with undo/redo and canvas-only preview.
  Discover imported simple max-width queries; preserve other conditions in the code editor.
- [x] Inspector provenance: show the selector, inline declaration, theme or breakpoint
  supplying a computed value and explain where an edit will be applied.
- [x] Explicit reusable component structure/instances, preserving ordinary HTML output.
- [ ] Browser interaction coverage: select, drag, resize, inline text, code edits, undo,
  responsive rendering, safe embeds, persistence, and designer/agent concurrency.
- [ ] Profile large imported designs before changing rendering. Measure input latency,
  layout work, memory and idle CPU; optimize dirty roots and offscreen artboards without
  dropping CSS animations or responsive behavior.

## Open-source choices

- Radix Select (MIT): accessible themed dropdowns, focus management, typeahead and viewport positioning.
- Radix Scroll Area (MIT): native scrolling with transient overlay scrollbars.
- PostCSS (MIT): ordered CSS AST and serialization.
- postcss-safe-parser (MIT): retain tolerant CSS editing while recovering partial syntax.
- postcss-value-parser (MIT): token references, including nested functions and fallbacks.
- postcss-selector-parser (MIT): structural selector edits without regex rewriting.
- Keep the existing CodeMirror, OpenPencil, Paper.js, Zustand and Vitest integrations.
- node-diff3 (MIT): three-way sequence/text merging, integrated with native DOM and PostCSS trees.
- async-mutex (MIT): serialize local storage and agent read/edit/write transactions.
- Browser sandbox, Web Crypto and conditional D1 updates cover isolation, hashes and
  concurrency; these do not require an additional framework.

## Verification and limits

- CSS regression tests cover interleaved media rules, importance, fallbacks, comments,
  token overrides, selector renaming and partial CSS input.
- Synchronization tests cover deferred incoming changes, serialized saves, retry,
  automatic overlap resolution, stale-save merging/retry and session closure.
  Merge tests cover text/attributes/inline styles/classes, insertions/deletions/moves,
  cycle repair, fallback declarations, nested overrides, tokens and page/frame metadata.
  The manual conflict panel, download choices and persistent conflict backups are removed.
- Cloud API tests use mocked R2/D1 and verify immutable reads, missing revision rejection,
  stale commits and database compare-and-swap races. Production deployment is unverified.
- Local store tests use temporary real files and verify stale-save rejection, concurrent
  agent operations, page deletion and asset retention.
- Browser smoke checks use a temporary workspace: forms and embeds render, nested scripts
  are blocked, inline text edits save, designer/agent edits automatically merge and save. Text commits before sync resumes.
- CSS/token serialization is cached by immutable sheet identity; unchanged artboards skip
  DOM reconciliation. Broader performance claims require large-design benchmarks.
- This is snapshot reconciliation, not a live collaboration CRDT. Exact overlapping values
  favor active unsaved local edits; it does not infer which author intended a different value.
  HTML uses stable data-pl-id identities (positional matching for markup without IDs);
  CSS uses selector/at-rule paths and declaration occurrences. Ambiguous structural edits
  and incomplete syntax are handled conservatively, rather than promising intent recovery.
  Local mutexes
  coordinate operations in one server process; arbitrary third-party disk writers do not
  participate in those locks. Compare-and-swap detects changes visible before a save.
- Historical cloud revisions are retained until project deletion. Add measured retention
  and orphan-upload cleanup before high-volume deployment, without deleting revisions that
  active editors still reference.

## Responsive/state editor verification

- PostCSS edits exact primary-class rules at the selected simple max-width context, keeping
  comments, fallbacks, importance and unrelated media/supports rules. Existing base controls
  continue to edit base declarations. The section identifies its class, state and width.
- Canvas preview uses a temporary iframe viewport and a selector-parser transform at the
  original specificity. It simulates selected states across applicable CSS contexts without
  changing HTML, styles.css, metadata or document revisions. Stopping preview restores sizing.
- Unit coverage includes creating classes/overrides, repeated rules, removal, custom widths,
  class renaming, selector specificity, export isolation and existing undo/redo history.
- Browser smoke verification covers adding a 375px hover override, automatic saving, reload,
  computed color and viewport width in preview, and restoration to the base color/480px box.
- Initial visual authoring covers max-width queries and the listed states on one selected
  element. Complex selectors/conditions, min-width/container queries and additional states
  remain editable through the existing code editor; preview does not reproduce native input
  interactions or actually disable controls. Inspector provenance is available in the Style source section.

## Inspector provenance verification

- Source details show the live computed value, authored selector, file/line, media/supports/
  layer context, importance, inheritance and referenced token origins. Base and variant edit
  destinations are explained. CSS field focus selects the property being inspected.
- PostCSS builds bounded, cached diagnostic stylesheets. Browser-registered diagnostic
  properties let the native cascade choose sources at original specificity and priority.
  Separate inherited/non-inherited markers distinguish direct declarations from inheritance.
  Diagnostic styles and temporary inline markers are always removed; exact style attributes
  are restored. Diagnostics do not alter document revisions, autosave or exports.
- Token references use the MIT PostCSS value parser. Alias dependencies are resolved at
  their declaration origin, rather than incorrectly using descendant overrides.
- Unit tests cover source mapping, importance, shorthands, resets, preview mapping, layers,
  safe cleanup/fallback and CSS value parsing. Real-browser checks in
  tests/browser/provenance-cases.ts exercise 16 cascade cases and verify unchanged markup/CSS.
- Limits are explicit: unsupported source tracing, imported external styles, anonymous
  layers, registered custom properties and selectors depending on inline style text do not
  receive a guessed winner. Animations identify the underlying declaration; their current
  computed value still comes from the browser. Inheritance tracing covers common text/SVG
  properties and ordinary custom properties. Untraced UA/presentation sources stay labeled.

## Reusable component verification

- Create/rename main components, insert linked instances beside a component or on another
  page, navigate to the main, reset instance overrides, detach links, and identify roots
  with diamond icons in Layers. With no selection, the inspector lists the component library.
- Optional project.json metadata stores main root names, stable element mappings, and the
  last applied main markup. HTML remains expanded semantic markup and CSS stays shared;
  deleting metadata loses links, never the visible design. No component runtime is exported.
- Reuse the existing semantic HTML/inline-CSS reconciliation and MIT node-diff3 for updates.
  Instance text, attribute, class and structural overrides are retained automatically.
  Untouched structure follows the main. CSS declarations remain shared; the existing class
  detachment control gives an element an independent class when desired.
- Edits, gesture previews, code edits, agent file loads and serialization synchronize links.
  Undo/redo include propagation in the initiating edit. Deleted mains detach surviving
  instances. Duplicating an instance keeps its link; duplicating a main creates another main.
- Main serialization is cached per nodes identity; unchanged main markup avoids merge work.
  Tests cover override retention, insertion/deletion, reset, duplication, pages, tables,
  SVG, malformed metadata, reload, external source edits, gestures and history. Browser checks
  verify creation, insertion, local text overrides, main propagation, reset/undo, detach/undo
  and reload. Plain disk edits propagate and are written back to HTML, not just rendered.
- Initial components are flat: nested definitions/instances are not created by the UI.
  Text correspondence uses parent plus text ordinal; ambiguous mixed-text structural edits
  inherit the conservative merge behavior. HTML ids must stay stable to retain links.

## Dropdown and inspector polish

- The font picker includes 20 free Google Fonts families for interface typography. Selecting
  a family adds its CSS API import (400/500/600/700, `display=swap`) to design CSS; opening
  the menu makes no font requests. System/bundled fonts need no Google request. Imports are
  deduplicated, undoable and survive saving/export. Availability checks use the selected
  artboard's font environment and refresh when web fonts finish loading.

- Inspector selects share the Radix Select primitive, styled with existing Plastic light/dark
  surface, text, radius, shadow and hover tokens. Portal positioning avoids inspector clipping;
  long menus scroll. Existing file, tool, token, zoom and dashboard action menus use matching
  neutral surfaces and highlights. Canvas HTML select elements keep their authored design.
- Empty inherit/reset values are encoded for Radix and decoded before invoking existing edit
  callbacks; custom imported values stay visible. Select keyboard focus excludes canvas tool
  shortcuts and deletion. Browser checks cover click/arrow selection, Escape, empty reset,
  font choices, overflow positioning, both themes and unchanged canvas selection.
- Style source is collapsed by default below the main inspector sections. Opening it restores
  full provenance details; tracing/observers stop while closed, so routine field edits do not
  run source diagnostics in the background.

## Layer selection and scrolling verification

- Selection reveals every selected node's ancestors and smoothly scrolls the most recently
  selected layer into view without moving keyboard focus. Reduced-motion preferences use
  immediate scrolling. Unchanged selection ids do not re-anchor on document edits, so manual
  scrolling and collapsing remain under user control.
- Layers, pages, theme tokens and inspector use Radix overlay scrollbars. The 5px scrollbar
  contains a subtle 3px thumb and disappears after scrolling stops; it reserves no gutter.
- React regression tests cover ancestor expansion, active-row state, scrolling, focus
  preservation, reduced motion and avoiding re-anchoring on unrelated edits. Browser checks
  selected a deeply nested item on the canvas and verified its layer appeared in view.

## Clipboard, Layer Dragging and Flex Controls

- Native copy/cut events work from both the editor and artboard documents. Cut deletes only
  after writing the clipboard successfully; paste restores editable nodes, CSS, names and
  component links. Repeated pastes receive independent node/class/SVG identities. Both cut
  and paste are undoable. Text inputs and inline text editing retain native clipboard behavior.
- Layer rows support dragging selected layers: the top/bottom quarters insert before/after,
  while the middle nests into a container. Drop indicators distinguish these actions; collapsed
  targets expand on hover and the panel scrolls near its edges. Cycles and void destinations
  are rejected. Nesting preserves names and removes only canvas placement metadata.
- Applied Flex uses a spatial alignment pad, vertical/horizontal direction, reverse, gap and
  paired horizontal/vertical padding. Advanced options retain distributed alignment, baseline,
  stretch, wrapping, separate gaps and Grid conversion; individual padding remains available.
  Controls write plain CSS and participate in normal undo/save/export.
- Regression checks cover clipboard failure, cut/paste undo, repeated copies, responsive CSS,
  SVG/asset references, component synchronization, sibling ordering, nesting and alignment.
  Browser checks include native shortcuts, root-to-child and child-to-root dragging, and the
  206-descendant Paper capture retaining its 280×289 size and background after cut/paste.

## Plain Rectangle Defaults

- New rectangles start with a white fill and their drawn width/height. Border and shadow are
  opt-in. The canvas host no longer adds a synthetic outline or shadow around top-level items,
  so existing designs display only their authored effects.
- Root elements with an explicit height expose that height in Layout; artboards using
  min-height retain their existing height control. Optional inspector controls track the
  selection that opened them.

## Canvas Rulers and Guides

- Horizontal and vertical rulers overlay the canvas without shifting its camera. Tick density
  adapts to zoom; labels track pan, negative coordinates and the selected artboard's origin.
  Selected bounds highlight both rulers, with a live pointer marker. Shift+R or Menu → Show
  Rulers toggles visibility; the preference persists in the browser.
- Drag from the top ruler to create a horizontal guide, or from the left ruler to create a
  vertical guide. Guides dropped inside an artboard are relative to its origin and clipped to
  its bounds; canvas guides use world coordinates. Frame guides move with their frame and
  follow copies and structural moves across pages.
- Drag guides to reposition, Alt/Option-drag to duplicate, Shift-drag to snap to ruler ticks,
  arrow keys to nudge (Shift ×10), and Delete/Backspace to remove. Returning a guide to a ruler
  or choosing Remove Guide from its context menu also removes it. Escape cancels a drag.
- Guides feed existing shape/move/resize snapping. They are stored per page in project.json,
  support undo/redo and save/reload, and never add elements or declarations to exported designs.
  Hiding rulers also hides guides and disables guide snapping.
- Validation covers coordinate math across zoom levels, negative labels, persistence, invalid
  metadata, snapping, copying/moving frame guides, drag cancellation and duplication. Browser
  checks cover both axes, nudging, deletion/undo, menu and ruler-return removal, Shift+R,
  reload and a rectangle drawn with its right edge snapping exactly to a vertical guide.
- Behavior reference: [Figma rulers and guides](https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames).

### Plain Text Insertion

New Text and Heading layers hug their content and own a neutral typography baseline. They have no wrapper, fill, border, padding, or shadow, and standalone roots render over a transparent iframe surface. Text defaults to 16px regular Inter; headings retain their heading size and weight. Inter Variable is bundled under its SIL Open Font License and added to the document only when chosen or new text is inserted. Its WOFF2 subsets are embedded in saved/exported CSS, so the default font works offline and travels with the design. Existing authored text is preserved. See [Google Fonts variable font API](https://developers.google.com/fonts/docs/css2) and the bundled `src/assets/fonts/inter/OFL.txt` license.

### Subtle Chrome Loading Skeletons

Startup/session checks, lazy app routes, file opening, the file grid/list, and the code panel now use layout-shaped skeletons with a slow, low-contrast metallic shimmer. Reduced-motion preferences stop the shimmer. Opening files no longer briefly display another project's layer controls. Pending canvas images receive measured, editor-only masks until loading and decoding finish; failures, replacement sources, deleted images and iframe teardown clear their masks safely. Loading decorations stay out of the document model and saved/exported design.

### Dropdown Clipping

Inspector token pickers, layout positioning, zoom, and theme token menus now use the [Radix Dropdown Menu primitive](https://www.radix-ui.com/primitives/docs/components/dropdown-menu). Portaled content escapes panel scroll clipping, avoids viewport edges, and scrolls when its contents exceed available height. Arrow keys, typeahead, Escape and focus restoration use the library's managed behavior. Canvas shortcuts and clipboard actions yield to an open menu. A regression test verifies portal placement, token binding, keyboard isolation, and focus return; the running editor was checked at panel edges.

### Auto Layout Sizing

Width and Height now expose Fixed, Fit, Fill, and Relative modes using ordinary CSS. Numeric input and canvas resizing switch the edited axis to Fixed; Fit hugs content, Fill uses flex growth on the main axis and stretch across it, and Relative uses percentages. Fill and Relative require a parent. Choosing Fill inside a Fit parent freezes that parent's current size on the same axis to prevent circular sizing. Nested flex children expose Absolute Position. Shift+A wraps text (including standalone canvas text) in an intrinsic flex frame with zero gap/padding and no added decoration, preserving the original text and undo history. Behavior follows [Figma's auto-layout sizing](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout) and [Paper's flex wrapping shortcut](https://paper.design/docs/support).

### Text Creation And Fill

The Text tool shows an empty caret and a live draft instead of inserting placeholder text. Leaving an empty draft creates no node or undo entry. Typed text commits as one insertion when editing ends, with Inter Variable and Fit width; multiline text stays intact. Initial text color chooses white or dark based on the composited container/ancestor background and the canvas color, with browser normalization for modern CSS color formats. Text color is edited under Fill as native CSS `color`; imported text backgrounds remain available under Background.

### Absolute Alignment Inside Flex

Absolute children of a flex parent now show Align in Parent controls for left/center/right and top/middle/bottom. Alignment uses the parent's padded area and the child's visible bounds, preserves its transforms and the other axis, and keeps it out of flex flow. Static flex parents become containing blocks as needed. Each action is undoable.

### AI Presence And Frame Reading

MCP calls now announce short-lived activity across HTTP and separate stdio processes. Targeted reads highlight their frame or layer with a quiet glow and scanning shimmer; write activity shows AI Editing. Whole-file reads highlight the current page's frames. Overlapping calls coexist, long calls refresh their leases, and stale sessions expire. Activity never changes or locks the design. The editor shows the active user's photo or initials and a bot avatar during activity. The MIT-licensed [loading-dev Blocks](https://loading.dev/spinners/blocks) spinner supplies the avatar indicator and animated favicon, which restores every original icon when activity ends. Reduced-motion settings disable the frame sweep. Current AI presence follows Plastic's local MCP transports; accounts on cloud deployments retain their user avatar.
