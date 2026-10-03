# Plastic Reference Export

A local Figma development plugin for capturing original Figma PNGs, node JSON, geometry and
font requirements. Capture does not edit the design. The plugin has no network access.

## Install Locally

1. In Figma Desktop, create a development plugin through Plugins → Development → New Plugin.
   Choose a plugin with a UI and copy the assigned `id` from Figma's generated manifest.
2. From the Plastic repository, build with that ID:

   ```sh
   PLASTIC_FIGMA_PLUGIN_ID=YOUR_ASSIGNED_ID bun run reference:build
   ```

3. Import `plugins/figma-reference-export/dist/manifest.json` through Figma's development
   plugin menu. The compiled main/UI are self-contained; no dev server or API key is required.

The build does not invent a published plugin ID. Without the environment variable it emits a
manifest without an ID; supply Figma's assigned ID if your development-plugin importer requires
it. This plugin has not been published to the Community.

## Capture a Fixture

1. Open a design you can use for evaluation. Save its current state as a native Figma local
   copy (`.fig`). Do not edit the design between saving that copy and capturing references.
2. Select visible top-level frames or components on the current page and run Plastic Reference
   Export. This initial version accepts unrotated/unscaled roots; nested selections are rejected.
3. Click **Capture References**, attach the matching `.fig`, choose a bundle name, and click
   **Download Reference Bundle**.
4. Unpack into a new folder, then evaluate:

   ```sh
   bun run reference:unpack path/to/bundle.zip path/to/new-fixture
   bun run benchmark:figma path/to/new-fixture/manifest.json
   ```

5. Add locally supplied WOFF2 font files to the manifest's `fonts` array when required. Inter
   normal weights are bundled with the evaluator. The Figma API exposes font requirements,
   not the original font binaries; it does not guarantee that your local face is the same
   version Figma used. Visual diffs help detect such differences.

The attached `.fig` contains the complete local copy, not only the selected frames. PNGs and
node JSON cover the selection. Nothing is enrolled in training or uploaded by this plugin.

## Bundle Contents

- `source.fig`: exact attached bytes, modern ZIP or legacy raw `fig-kiwi`.
- `manifest.json`: benchmark cases with original Figma IDs and node expectations.
- `references/frame-N.png`: Figma PNG at 1×, sRGB, contents-only, full frame bounds.
- `nodes/frame-N.json`: Figma's `JSON_REST_V1` export, before any Plastic conversion.
- `capture.json`: exporter version, timestamp, file/page names, frame dimensions, font
  requirements and SHA-256 hashes of the source, references and raw JSON.

JSON is exported before and after PNG capture. A changed frame, missing font, malformed PNG,
invalid selection or reference extending beyond its frame fails capture. The benchmark checks
hashes and original frame ID/name/dimensions before evaluating; this is not a complete proof
that every property in the attached `.fig` equals the live document. Snapshot mismatches that
pass those preliminary checks are still measured by geometry/text/visual comparisons.

Hidden subtrees are omitted from geometry expectations. Expanded instance IDs (`I…;…`) are
retained in raw node JSON, but omitted from assertions until their exact correspondence to
expanded binary-import nodes is supported. Composited vector descendants can fail editability
checks even when their pixels match; the importer trace identifies these as flattened.

## Verification

```sh
bun run reference:typecheck
bun run test tests/figma-reference-export.test.ts
bun run reference:check
```

`reference:check` uses a headless browser, the built plugin UI, simulated Figma messages, a
real SDK-encoded `.fig`, ZIP download/extraction and the actual canvas renderer. It also checks
checksum corruption, escaping paths and stale source dimensions. It writes disposable artifacts
to the system temporary directory. It does not claim these generated references came from Figma.
Set `PLASTIC_CHROMIUM_PATH` when using an existing compatible Chromium installation.

Live Figma installation/capture still needs to be verified in Figma Desktop. The repository
currently contains synthetic fixtures and pipeline tests; a genuine-reference corpus must be
captured with this plugin before it can substantiate Figma fidelity results.
