# Browser Regression Checks and Rendering Profile

The development-only runner is at `/tests/browser/editor.html`. It mounts the real
Editor, Canvas, Layers, Inspector and CodeMirror, and creates disposable projects through
the local workspace API. It is not included in the production build.

## Run the Checks

Start a separate development server with a disposable workspace:

```sh
PLASTIC_WORKSPACE=/private/tmp/plastic-browser-checks bun run dev -- --port 5174 --strictPort
```

Open `http://localhost:5174/tests/browser/editor.html` and click **Run Interaction Checks**.
The runner reports failures with stack traces and stops at the first failure. Re-running
creates a fresh project. No existing design is modified.

The ten checks exercise:

1. Canvas pointer selection.
2. Pointer drag and the resulting position.
3. Resize handles and the resulting dimensions.
4. Keyboard undo restoring the dimensions.
5. Double-click inline text editing and commit.
6. CodeMirror input transactions updating the rendered text.
7. Native media-query rendering at 375px and restoration.
8. Artboard sandbox and nested embed isolation.
9. Actual disk persistence followed by Editor unmount/remount.
10. A real workspace write during an active designer transaction, followed by merging
    both authors' changes and saving the combined result.

These are real Chromium browser checks using dispatched pointer/keyboard/input events and
CodeMirror's input transactions. They are not jsdom tests, but do not simulate OS event
trust or clipboard permissions. A native browser drag was also checked separately.
The runner is currently interactive, not an unattended CI browser job. Safari and Firefox
coverage remains a follow-up.

## Profile the Large Fixture

Click **Load Large Design and Profile**. The fixture is imported HTML/CSS with 24 artboards,
2,880 cards and 20,184 design nodes. Each card includes an animated element. The layer trees
start collapsed; roots are placed 820px apart, so most artboards are offscreen at 80% zoom.
Click **Repeat Profile** to sample the loaded fixture again.

The runner records 30 selection updates, 15 dispatched pointer selections and 15 single-root
text edits. Each interval ends after two animation frames. These are input/update-to-frame
proxies, not hardware input latency or guaranteed presentation timestamps. The profile also
records long tasks and an optional Chromium heap estimate. It verifies that offscreen
animation time advances, the same Animation object survives panning, responsive preview
works offscreen and restores, and all 24 iframe documents remain mounted.

For idle work, enable Chrome DevTools Protocol `Performance`, sample `Performance.getMetrics`,
wait at least five seconds without interacting, then sample again. Divide differences by
the `Timestamp` interval. Record `TaskDuration`, `ScriptDuration`, `LayoutDuration`,
`RecalcStyleDuration`, counts and `JSHeapUsedSize`. Task time percentage is renderer main-thread
work, not whole-machine CPU. Keep animation enabled and the same browser visibility state.

## Local Results — 3 October 2026

The checked-in JSON records the before and after samples from the Codex in-app Chromium
browser on the development build. Final verification used an isolated source snapshot of main
plus this task’s changes because unrelated work in the shared checkout triggered hot reloads. These are exploratory samples, not release thresholds
or a statistical cross-device benchmark.

| Metric | Before | After |
| --- | ---: | ---: |
| Selection update to two frames, median | 59.3 ms | 36.4 ms |
| Selection update to two frames, p95 | 95.0 ms | 66.4 ms |
| Idle main-thread task time / elapsed time | 63.3% | 18.3% |
| Idle style recalculation time / second | 325 ms | 77 ms |
| Idle layout duration | 0 ms | 0 ms |
| Settled JS heap | 56.7 MiB | 53.0 MiB |

After optimization, dispatched pointer selection measured 39.1 ms median / 60.9 ms p95;
a single-root text edit measured 48.8 ms median / 70.5 ms p95. Heap values vary with garbage
collection; the change does not claim a memory reduction. All iframe documents remain resident.
The before idle interval was 22.45s and the after interval 5.01s; rates are normalized by elapsed
time. Warm-up, JIT, development overhead and other activity can influence these measurements.

## Rendering Changes

- `DomRenderer.render` reports whether the root DOM changed. Unchanged roots avoid image scans
  and iframe fitting; shared CSS/token changes still trigger the necessary layout work.
- Responsive preview invalidates only the artboard containing its target.
- Overlay titles use saved world positions and ResizeObserver-maintained iframe dimensions;
  they do not force offscreen document layout every animation frame.
- Native `content-visibility: auto` skips offscreen painting with a preserved measured intrinsic
  box. Artboards stay mounted. Changed content initializes animation styles before returning
  to browser-controlled skipping, so animation timelines also exist for initially offscreen
  roots. Browsers without this CSS feature retain the normal rendering path.

This establishes a baseline and a measured first optimization. Expanded layer trees, images,
external fonts, complex SVG, animation-driven size changes, more devices and production builds
need additional profiles before stronger performance claims or further virtualization.
