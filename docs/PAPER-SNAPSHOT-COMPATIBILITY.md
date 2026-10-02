# Paper Snapshot compatibility research

Researched 2026-10-03. Initial research was followed by implementation of artboard HTML paste.

## Implemented support

`src/editor/clipboard.ts` now handles native HTML and plain-text paste into a selected existing artboard, or directly onto the active page's canvas when no artboard is selected. It unwraps Paper captures, sanitizes HTML/SVG with DOMPurify, gives nodes and SVG references fresh identities, and converts captured inline declarations to independent primary CSS classes. Paste is one undoable document operation. Text fields, CodeMirror and inline editing retain their own paste behavior. Both the editor window and artboard documents register paste handlers.

Validation: 153 automated tests passed, including ten clipboard tests; production build passed. Browser paste, undo/redo and normal textarea paste were checked. A subsequent real capture exposed the extension's omitted reset defaults: border widths/styles, transparent backgrounds, and inherited form-control typography must be restored before applying captured declarations. The importer now applies that baseline only to Paper-format captures, without resetting SVG paint attributes or other artboard content. The already-pasted capture was repaired through its CSS rules. Direct canvas paste was also verified in the browser on an empty page: the imported content became one root without an extra wrapper, and undo restored the empty page. A fresh paste using its reconstructed pre-repair inline declarations retained the 280 × 289 capture size, zero unintended borders, transparent button background and inherited text color. The original clipboard bytes remain unavailable; this validates the saved capture's structure/styles rather than a new extension capture. Clipboard image-file import, durable remote asset ingestion and font collection remain future work. External capture image URLs are currently retained.

## Conclusion

Plastic can plausibly accept the existing official Paper Snapshot extension's output without modifying the extension. Its clipboard transport is standard HTML, not a private Paper document format. This is verified by static inspection of the distributed extension; an actual browser capture and paste into Plastic has not yet been tested.

## Evidence

- [Official quick start](https://paper.design/snapshot-extension): activate the extension, select an element, capture it, then paste into the destination editor.
- [Official Chrome extension](https://chromewebstore.google.com/detail/paper-snapshot/lidfahaahiogmnlccifabccgplofocck): extension ID `lidfahaahiogmnlccifabccgplofocck`. The Chrome update service returned manifest version **0.4.4** during this inspection. The store's indexed version can lag the delivered package.
- Static inspection of that package's `background.js` and `offscreen.js`: captured markup is wrapped in `<x-paper-html>`, sent to an offscreen clipboard document, and written to `text/html` through a copy event. The clipboard writer does not set a proprietary MIME type or explicitly set plain text. The inspected delivery path does not require the destination to be Paper.
- The capture code reads computed styles and geometry, serializes inline styles, processes pseudo-element content, traverses open shadow roots, and handles image elements. This is a snapshot of rendered structure and appearance, not a transfer of the site's JavaScript application.
- [Paper HTML paste documentation](https://paper.design/docs/paste/html): Paper imports inline-styled HTML as editable layers and retrieves public image URLs. Paper-specific clone operations and metadata are separate from ordinary HTML.
- [Browser clipboard event API](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData): a destination can retrieve HTML from the user's paste event with `clipboardData.getData('text/html')`.

The extension was downloaded for static inspection only, not installed or executed. No bundled implementation was copied into Plastic. There is no established public compatibility contract for the wrapper; retain a fixture and retest when the extension changes.

## Plastic today

- `src/serialization/html.ts` already converts HTML and SVG into document nodes, preserving inline styles and semantic attributes. It currently treats the wrapper as an ordinary custom element; a clipboard importer must unwrap it.
- `src/editor/shortcuts.ts` has no canvas paste integration. Existing clipboard uses are copy actions for code and connection settings.
- `src/canvas/ArtboardHost.tsx` renders artboards in a sandbox without script execution. HTML parsing skips several executable/document-level tags, but this is not a complete clipboard sanitization policy.
- Inspector controls primarily modify a node's primary CSS class. Imported inline declarations can override those edits. Import normalization is necessary for reliable editing.

## Recommended implementation

1. Add a canvas paste router using the native paste event. Leave input fields, text editing, CodeMirror, and editable controls' normal paste behavior intact. Account for focus inside artboard iframes.
2. Detect and unwrap Paper HTML; sanitize HTML/SVG with an established library such as [DOMPurify](https://github.com/cure53/DOMPurify). Apply explicit URL, attribute, and CSS policies as well; HTML sanitization alone does not validate CSS or make remote assets permanent.
3. Parse into Plastic's existing node model with fresh IDs. Convert imported inline declarations into unique, scoped primary classes using the existing PostCSS tools, preserving declaration ordering, priorities, and custom properties. Verify visual fidelity and that inspector edits take effect.
4. Paste directly onto the canvas when no artboard is selected, using the captured elements themselves as page roots. Preserve captured sizes and relative children; use frame metadata for canvas placement and clear website viewport offsets from new roots. When an artboard is selected, paste into it. Commit nodes, styles, frames and selection as one undoable operation through normal save/sync behavior.
5. Persist supported image assets through Plastic's asset pipeline. Surface inaccessible assets instead of silently treating remote or expiring URLs as durable. Fonts require separate availability/fallback handling.
6. Extend the router to ordinary rich HTML, SVG, clipboard image files, and plain text. Treat text as text by default; provide an explicit path for importing markup from copied source code.

## Scope and verification

| Clipboard content | Intended outcome |
| --- | --- |
| Paper Snapshot HTML | Editable HTML/CSS hierarchy |
| Ordinary rich HTML | Editable structure; fidelity depends on supplied styles |
| SVG markup or files | Vector nodes where supported |
| PNG/JPEG and screenshot clipboard files | Image layers, not reconstructed editable UI |
| Plain text | Text layer |
| Proprietary design-app payloads | Require a dedicated adapter; cannot promise arbitrary compatibility |

The capture cannot recreate application logic, responsive breakpoints absent from the snapshot, or unavailable assets/fonts. Protected pages, closed shadow roots, and embedded content can also limit capture. Paper-specific `<x-paper-clone>` references cannot resolve to Plastic document nodes.

Before claiming support, test the real extension against a flex/grid page with mixed text, SVG and images; verify paste focus, editable styles, undo/redo, save/reload, duplicate imports, and sanitization. Also test ordinary text/image paste and ensure existing editor-field paste remains intact.

## Open-source options

Consuming the standard clipboard output requires no capture library. Reuse Plastic's parser and PostCSS, and use DOMPurify for HTML sanitization rather than writing another sanitizer.

[vcashwin/paper-snapshot](https://github.com/vcashwin/paper-snapshot) is a community MIT-licensed capture package worth evaluating if Plastic later needs its own capture UI. It is not the official Paper-owned extension repository; its claims of engine equivalence should not be treated as verified provenance. No official extension source license was established in this research.
