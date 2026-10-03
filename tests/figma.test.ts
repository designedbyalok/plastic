// @vitest-environment jsdom
import { SceneGraph } from '@open-pencil/scene-graph';
import { describe, expect, it } from 'vitest';
import { convertGraph } from '../src/figma/convert.ts';
import { parseProject } from '../src/serialization';
import type { ElementNode } from '../src/document/types';

const white = { r: 1, g: 1, b: 1, a: 1 };
const indigo = { r: 0.31, g: 0.27, b: 0.9, a: 1 };
const solid = (color: typeof white) => [{ type: 'SOLID' as const, color, opacity: 1, visible: true }];

/** Two pages; a card with vertical auto layout, a fill-width button and a free-positioned badge. */
function sample(): SceneGraph {
  const g = new SceneGraph();
  const page = g.getPages()[0]!;
  g.updateNode(page.id, { name: 'Home' });
  const card = g.createNode('FRAME', page.id, {
    name: 'Card', x: 100, y: 40, width: 320, height: 200, fills: solid(white), cornerRadius: 12,
    layoutMode: 'VERTICAL', itemSpacing: 12, paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
    primaryAxisSizing: 'HUG', counterAxisSizing: 'FIXED', counterAxisAlign: 'MIN', clipsContent: true,
  });
  g.createNode('TEXT', card.id, {
    name: 'Title', text: 'Hello Figma', fontFamily: 'Plastic Test Sans', fontSize: 32, fontWeight: 700, lineHeight: 40,
    textAutoResize: 'WIDTH_AND_HEIGHT', width: 180, height: 40, fills: solid({ r: 0.07, g: 0.09, b: 0.15, a: 1 }),
  });
  const button = g.createNode('FRAME', card.id, {
    name: 'Button', width: 272, height: 44, fills: solid(indigo), layoutMode: 'HORIZONTAL', primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    layoutAlignSelf: 'STRETCH', primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED',
  });
  g.createNode('TEXT', button.id, { name: 'Label', text: 'Continue', fontFamily: 'Plastic Test Sans', fontSize: 14, textAutoResize: 'WIDTH_AND_HEIGHT', width: 60, height: 20, fills: solid(white) });
  g.createNode('ELLIPSE', card.id, { name: 'Badge', layoutPositioning: 'ABSOLUTE', x: 290, y: 10, width: 20, height: 20, fills: solid(indigo), horizontalConstraint: 'MAX' });
  const second = g.addPage('Pricing');
  g.createNode('FRAME', second.id, { name: 'Plans', x: 0, y: 0, width: 1440, height: 900, fills: solid(white) });
  return g;
}

describe('Figma import', () => {
  const { files, report } = convertGraph(sample(), 'Sample');
  const css = files['styles.css']!;

  it('keeps every page as its own HTML file, with artboards at their canvas positions', () => {
    expect(report.pages).toEqual([
      { name: 'Home', file: 'index.html', artboards: 1 },
      { name: 'Pricing', file: 'pricing.html', artboards: 1 },
    ]);
    const { doc } = parseProject(files);
    expect(doc.pages.map((p) => p.name)).toEqual(['Home', 'Pricing']);
    expect(doc.frames[doc.pages[0]!.roots[0]!]).toEqual({ x: 100, y: 40 });
    expect(doc.names[doc.pages[0]!.roots[0]!]).toBe('Card');
  });

  it('turns auto layout into flexbox with Figma sizing', () => {
    expect(css).toContain(['.card {', '  position: relative;', '  width: 320px;'].join('\n'));
    expect(css).toMatch(/\.card \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*align-items: flex-start;[^}]*gap: 12px;[^}]*padding: 24px;/);
    expect(css).not.toMatch(/\.card \{[^}]*height:/); // hug height
    expect(css).toMatch(/\.card \{[^}]*overflow: hidden;/);
    // Fill width (stretch) on the counter axis, fixed height, and centered content.
    expect(css).toMatch(/\.button \{[^}]*align-self: stretch;[^}]*height: 44px;/);
    expect(css).not.toMatch(/\.button \{[^}]*width:/);
    expect(css).toMatch(/\.button \{[^}]*justify-content: center;[^}]*align-items: center;/);
    // Absolute children keep their constraint (pinned right).
    expect(css).toMatch(/\.badge \{[^}]*position: absolute;[^}]*right: 10px;[^}]*top: 10px;[^}]*border-radius: 50%;/);
  });

  it('maps text to semantic elements and fonts to tokens', () => {
    const html = files['index.html']!;
    expect(html).toMatch(/<h2 class="title"[^>]*>Hello Figma<\/h2>/);
    expect(css).toMatch(/\.title \{[^}]*margin: 0;[^}]*font-family: var\(--font-plastic-test-sans\);[^}]*font-size: 32px;[^}]*font-weight: 700;[^}]*line-height: 40px;/);
    expect(files['tokens.css']).toContain('--font-plastic-test-sans: "Plastic Test Sans", sans-serif;');
    expect(report.fonts).toEqual([{ family: 'Plastic Test Sans', token: 'font-plastic-test-sans', weights: [400, 700], italic: false, layers: 2 }]);
  });

  it('turns variables into tokens and bound fields into var()', () => {
    const g = sample();
    g.variableCollections.set('c1', { id: 'c1', name: 'Theme', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }], defaultModeId: 'light', variableIds: ['v1'] });
    g.variables.set('v1', { id: 'v1', name: 'Colors/Brand/Primary', type: 'COLOR', collectionId: 'c1', valuesByMode: { light: indigo, dark: white }, description: '', hiddenFromPublishing: false });
    const button = [...g.nodes.values()].find((n) => n.name === 'Button')!;
    g.updateNode(button.id, { boundVariables: { 'fills/0/color': 'v1' } });
    const out = convertGraph(g, 'Tokens');
    expect(out.files['tokens.css']).toContain('--color-brand-primary: #4f45e6;');
    expect(out.files['tokens.css']).toContain('[data-mode="dark"] {\n  --color-brand-primary: #ffffff;\n}');
    expect(out.files['styles.css']).toMatch(/\.button \{[^}]*background: var\(--color-brand-primary\);/);
  });

  it('hides hidden layers the way Plastic does, so a class display can’t bring them back', () => {
    const g = sample();
    const label = [...g.nodes.values()].find((n) => n.name === 'Label')!;
    const button = [...g.nodes.values()].find((n) => n.name === 'Button')!;
    g.createNode('TEXT', button.id, { name: 'Hint', text: 'Hidden', fontFamily: 'Plastic Test Sans', fontSize: 14, textAutoResize: 'WIDTH_AND_HEIGHT', width: 40, height: 20, fills: solid(white), visible: false });
    g.updateNode(button.id, { visible: false });
    const out = convertGraph(g, 'Hidden');
    const html = out.files['index.html']!;
    expect(html).not.toMatch(/ hidden[ >]/);
    const doc = parseProject(out.files).doc;
    const el = (name: string) => Object.values(doc.nodes).find((n): n is ElementNode => n.kind === 'element' && doc.names[n.id] === name)!;
    const rule = (name: string) => doc.styles.rules[el(name).classes[0]!]!;
    expect(rule('Button').display).toBe('none');
    expect(el('Button').attrs['data-pl-display']).toBe('flex');
    expect(rule('Hint').display).toBe('none');
    expect(label.visible).toBe(true);
    expect(rule('Label').display).not.toBe('none');
  });

  it('gives number variables used as lengths a unit, and same-named variables their own tokens', () => {
    const g = sample();
    g.variableCollections.set('c1', { id: 'c1', name: 'Spacing', modes: [{ modeId: 'm', name: 'Default' }], defaultModeId: 'm', variableIds: ['a', 'b'] });
    g.variableCollections.set('c2', { id: 'c2', name: 'Other', modes: [{ modeId: 'm2', name: 'Default' }], defaultModeId: 'm2', variableIds: ['c'] });
    const v = (id: string, name: string, collectionId: string, value: number) =>
      g.variables.set(id, { id, name, type: 'FLOAT', collectionId, valuesByMode: { [collectionId === 'c1' ? 'm' : 'm2']: value }, description: '', hiddenFromPublishing: false });
    v('a', '24', 'c1', 24);
    v('b', 'Ratio', 'c1', 3);
    v('c', '24', 'c2', 24);
    const card = [...g.nodes.values()].find((n) => n.name === 'Card')!;
    g.updateNode(card.id, { boundVariables: { paddingTop: 'a', paddingRight: 'a', paddingBottom: 'a', paddingLeft: 'a', itemSpacing: 'c' } });
    const tokens = convertGraph(g, 'Units').files;
    expect(tokens['tokens.css']).toContain('--t-24: 24px;');
    expect(tokens['tokens.css']).toContain('--t-24-2: 24px;');
    expect(tokens['tokens.css']).toContain('--ratio: 3;');
    expect(tokens['styles.css']).toMatch(/\.card \{[^}]*gap: var\(--t-24-2\);[^}]*padding: var\(--t-24\);/);
  });

  it('paints in layer order when an auto layout frame also has absolute layers', () => {
    // The badge is absolute; the title, button and label flow. Positioning the flowing layers
    // keeps the CSS paint order the same as Figma's layer order.
    expect(css).toMatch(/\.title \{[^}]*position: relative;/);
    expect(css).toMatch(/\.button \{[^}]*position: relative;/);
    expect(css).not.toMatch(/\.label \{[^}]*position: relative;/); // its frame has no absolute layers
  });

  it('draws straight lines in a box as thick as their stroke, taking no room in the layout', () => {
    const g = sample();
    const card = [...g.nodes.values()].find((n) => n.name === 'Card')!;
    g.createNode('LINE', card.id, {
      name: 'Rule', width: 200, height: 0, layoutAlignSelf: 'STRETCH',
      strokes: [{ color: indigo, weight: 2, opacity: 1, visible: true, align: 'CENTER', cap: 'NONE', join: 'MITER', dashPattern: [2, 2] }],
    });
    const out = convertGraph(g, 'Lines');
    expect(out.files['styles.css']).toMatch(/\.rule \{[^}]*height: 2px;[^}]*margin-block: -1px;/);
    expect(out.files['index.html']).toMatch(/<svg class="rule"[^>]*viewBox="0 -1 \d+ 2"/);
  });
});
