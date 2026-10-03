# Figma Import Fidelity Engine

The first milestones are a traceable importer, a local evaluation pipeline and a Figma reference exporter. It does not train a
model, send designs to an AI provider, or collect training examples from users.

## Implemented

- Importer version `1.1.0` and schema version `1`.
- Original Figma IDs (with internal scene IDs retained separately) mapped to Plastic IDs, with page, name, type, source-local bounds and
  conversion disposition. SVG-composited descendants are marked `flattened` rather than claimed
  as separately editable layers. The trace covers converted layers, not every decoded source
  property or deliberately omitted instance child.
- Known diagnostics attached to source layers: missing image bytes, approximated masks,
  expanded instances, composited SVG descendants and generic conversion of unsupported types.
  These are observations, not a comprehensive feature compatibility score.
- Trace retained in `project.json` across edits/reloads. It records the original import; deleted
  layers can therefore leave historical mappings. Exported HTML has no extra Figma attributes.
- A bounded, expandable Conversion Details list in the import report, compatible with older
  reports that do not include diagnostics.
- Decode and conversion wall-clock timings. Conversion includes cooperative yielding and
  serialization; it is not a measurement of browser paint, memory or input latency.
- Versioned manifests and a local browser evaluator using Playwright, Pixelmatch and PNGJS.
  Browser output uses Plastic's actual `DomRenderer`, parser and CSS serializers.
- Fixed viewport and device scale, bundled Inter faces, optional locally supplied WOFF2 fonts,
  awaited fonts/images, disabled screenshot animations, blocked external browser requests.
- Per-frame PNGs for reference, actual and diff; JSON reports include hashes, importer/browser
  versions, visual differences, explicit geometry/text/weight checks, diagnostics and timings.
  Failed comparisons exit nonzero. References are never regenerated from importer output.

## Run

```sh
bun install
bunx playwright install chromium
bun run benchmark:figma
bun run benchmark:figma path/to/manifest.json another/manifest.json
```

For an already installed compatible Chromium, set `PLASTIC_CHROMIUM_PATH` to its executable.
Set `PLASTIC_BENCHMARK_OUTPUT` to change the default ignored `artifacts/figma-import` directory.
The runner starts an ephemeral server bound to `127.0.0.1`; it doesn't need the editor server,
workspace projects, a Figma account or a cloud account. Run from the repository root.

## Add Genuine Figma References

Place an authorized `.fig` file and Figma-exported PNGs in one fixture directory. At scale 1,
PNG dimensions must equal the frame viewport. Pin any required fonts as licensed WOFF2 files;
otherwise the evaluator fails the case rather than silently substituting fonts.

```json
{
  "schemaVersion": 1,
  "id": "authorized-card",
  "source": { "kind": "figma", "path": "card.fig" },
  "fonts": [{ "family": "Example Sans", "path": "fonts/example.woff2", "weight": "100 900" }],
  "frames": [{
    "id": "card",
    "sourceId": "1:2",
    "width": 320,
    "height": 200,
    "reference": { "kind": "figma-png", "path": "card.png" },
    "maxDiffRatio": 0.01,
    "nodes": [{
      "sourceId": "1:3",
      "bounds": { "x": 24, "y": 24, "width": 272, "height": 28 },
      "text": "Continue",
      "fontWeight": "500"
    }]
  }]
}
```

Use original Figma IDs from `import-trace.json`. Importer 1.1.0 preserves these IDs across repeated binary reads; earlier 1.0.0 traces used decoder-generated scene IDs.
Geometry expectations are relative to the isolated frame viewport, in CSS pixels, with a 0.75 px
allowance. Visual comparison uses Pixelmatch threshold 0.1 and ignores detected antialiasing.
A diff ratio is a pixel mismatch fraction, not a perceptual similarity or editability score.
Individual node checks verify explicitly listed expectations; not all node semantics.

## Initial Baseline

The checked-in layout scene and independent HTML references are **synthetic**. They cover flex
spacing, padding, Fill sizing, an absolute child, hidden content, and Inter weights 400/500.
Both frames produced zero different pixels and passed their geometry/text checks in Chromium.
Deliberately changing an expected width fails even with zero pixel differences; changing the
reference background fails with 79.052% differing pixels. The runner exits 1 for these negative
checks. The saved baseline is evidence for the harness, not proof of Figma import accuracy.

A local development plugin now captures genuine PNG/data reference bundles, paired with a
matching attached native `.fig` copy. See [plugin installation and capture instructions](../plugins/figma-reference-export/README.md).
Use `bun run reference:build`, `reference:unpack` and `reference:check` for the local workflow.
Capture metadata checksums are verified before evaluation, and frame identity/dimensions are
checked against the binary source. Node assertions are scoped to the selected frame to avoid
matching descendants from another component instance. Only that frame's captured font
requirements must be pinned when capture metadata is present.

The exporter and bundle pipeline pass six end-to-end checks using simulated Figma transport;
actual installation/export in Figma Desktop has not been verified. No genuine Figma reference
corpus has been added yet. Use owned or licensed examples, keep
training and held-out evaluation files separate, and group related templates into the same split.
Font/reference hashes and the browser version allow baseline results to be interpreted in context.

## Next Milestones

1. Install and verify the implemented Figma reference exporter in Figma Desktop; capture a
   genuine corpus covering grids, variables, masks, vectors, images, typography, effects and
   component overrides. The plugin and its local bundle/evaluation pipeline are built.
2. Per-layer mismatch localization and explicit unsupported-property coverage. Measure large-file
   import overhead before expanding observation payloads.
3. A local, opt-in correction-record format: source features, candidate patch, evaluation before/
   after and reviewer confirmation. Ordinary design edits must not be interpreted as fixes.
4. AI repair in a temporary document, with constrained patch validation, re-rendering, retry
   limits and structural safeguards. Promote only verified improvements.
5. Retrieval from validated corrections, then model training and versioned release gates on a
   separate held-out corpus. No online retraining on unreviewed customer imports.
