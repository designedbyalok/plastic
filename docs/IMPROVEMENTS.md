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

- [x] First visual breakpoint/state editor: presets and custom max-width breakpoints;
  default, hover, focus, focus-visible, active and disabled states. Add/edit/remove ordinary
  CSS declarations in a dedicated inspector section with undo/redo and canvas-only preview.
  Discover imported simple max-width queries; preserve other conditions in the code editor.
- [ ] Inspector provenance: show the selector, inline declaration, theme or breakpoint
  supplying a computed value and explain where an edit will be applied.
- [ ] Explicit reusable component structure/instances, preserving ordinary HTML output.
- [ ] Browser interaction coverage: select, drag, resize, inline text, code edits, undo,
  responsive rendering, safe embeds, persistence, and designer/agent concurrency.
- [ ] Profile large imported designs before changing rendering. Measure input latency,
  layout work, memory and idle CPU; optimize dirty roots and offscreen artboards without
  dropping CSS animations or responsive behavior.

## Open-source choices

- PostCSS (MIT): ordered CSS AST and serialization.
- postcss-safe-parser (MIT): retain tolerant CSS editing while recovering partial syntax.
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
  interactions or actually disable controls. Full inspector provenance is next.
