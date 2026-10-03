// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { rulerTicks, guideScreenPosition } from '../src/canvas/rulerGeometry';
import { setRulerGuide, removeRulerGuide } from '../src/document/guides';
import { readProjectJson } from '../src/serialization/project';
import { parseProject, serializeProject } from '../src/serialization';
import { useEditor } from '../src/editor/store';
import { collectTargets, snapPoint, setSnapPref } from '../src/canvas/snap';
import { pastePlasticNodes } from '../src/document/clipboardNodes';
import { moveLayers } from '../src/document/layerMove';
import { instantiate } from '../src/document/factory';
import { insertRoot, setFrame } from '../src/document/ops';
import { addPage } from '../src/document/pages';
import { docFrom } from './helpers';

afterEach(() => { vi.restoreAllMocks(); setSnapPref('objects', true); useEditor.setState({ rulersVisible: true }); });

describe('ruler coordinates', () => {
  it('keeps labels aligned to world coordinates across zoom, pan and negative positions', () => {
    for (const zoom of [.05, .2, 1, 4, 16]) {
      const ticks = rulerTicks(1200, 257, zoom, 480);
      expect(ticks.length).toBeLessThan(100);
      for (const tick of ticks) {
        expect(tick.position).toBeCloseTo((tick.value + 480) * zoom + 257);
        expect(tick.position).toBeGreaterThanOrEqual(0);
        expect(tick.position).toBeLessThanOrEqual(1200);
      }
      const major = ticks.filter((t) => t.major);
      if (major.length > 1) expect(major[1]!.position - major[0]!.position).toBeGreaterThanOrEqual(80 - 1e-8);
      expect(ticks.some((tick) => tick.value < 0)).toBe(true);
    }
    expect(guideScreenPosition({ id: 'g', axis: 'x', value: 40 }, { x: 80, y: 60, zoom: 2 }, 100)).toBe(360);
  });
});

describe('persistent ruler guides', () => {
  it('saves page/frame guides without putting alignment aids into exported design markup', () => {
    const f = docFrom({ tag: 'main', className: 'frame', style: { width: '400px' } });
    let doc = setRulerGuide(f.doc, 'index.html', { id: 'page-guide', axis: 'y', value: -20 });
    doc = setRulerGuide(doc, 'index.html', { id: 'frame-guide', axis: 'x', value: 16, frame: f.root });
    const files = serializeProject(doc, { viewport: null, activePage: null, collapsed: [] });
    expect(files['index.html']).not.toContain('page-guide');
    expect(files['styles.css']).not.toContain('frame-guide');
    const saved = parseProject(files).doc;
    expect(saved.pages[0]!.guides).toEqual(doc.pages[0]!.guides);
    useEditor.getState().load(saved);
    useEditor.getState().apply('Move Guide', (d) => setRulerGuide(d, 'index.html', { id: 'page-guide', axis: 'y', value: 24 }));
    expect(useEditor.getState().doc.pages[0]!.guides?.[0]?.value).toBe(24);
    useEditor.getState().undo(); expect(useEditor.getState().doc).toBe(saved);
    useEditor.getState().redo();
    useEditor.getState().apply('Remove Guide', (d) => removeRulerGuide(d, 'index.html', 'page-guide'));
    expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(1);
    useEditor.getState().undo(); expect(useEditor.getState().doc.pages[0]!.guides).toHaveLength(2);
  });
  it('ignores malformed and orphaned metadata while retaining valid guides', () => {
    const f = docFrom({ tag: 'main' });
    const files = serializeProject(f.doc, { viewport: null, activePage: null, collapsed: [] });
    const project = JSON.parse(files['project.json']!);
    project.pages[0].guides = [{ id: 'g', axis: 'x', value: 20 }, { id: 'g', axis: 'y', value: 10 }, { id: 'bad', axis: 'z', value: 0 }, { id: 'invalid', axis: 'x', value: null }, { id: 'orphan', axis: 'x', value: 4, frame: 'missing' }];
    const json = JSON.stringify(project);
    expect(readProjectJson(json).pages[0]!.guides).toHaveLength(2);
    expect(parseProject({ ...files, 'project.json': json }).doc.pages[0]!.guides).toEqual([{ id: 'g', axis: 'x', value: 20 }]);
  });
  it('uses canvas guides for snapping, including on an empty canvas, and hides their snapping with rulers', () => {
    const f = docFrom({ tag: 'main' });
    const doc = setRulerGuide(f.doc, 'index.html', { id: 'g', axis: 'x', value: 100 });
    useEditor.getState().load(doc); useEditor.setState({ rulersVisible: true, viewport: { x: 80, y: 60, zoom: 2 } });
    const targets = collectTargets(null, []);
    expect(targets.xs).toContain(280);
    expect(snapPoint({ x: 283, y: 20 }, targets, false).x).toBe(280);
    useEditor.setState({ rulersVisible: false });
    expect(collectTargets(null, []).xs).not.toContain(280);
  });
  it('copies frame guides with new identities and moves them across pages with their frame', () => {
    const f = docFrom({ tag: 'main' });
    const guided = setRulerGuide(f.doc, 'index.html', { id: 'frame-guide', axis: 'x', value: 16, frame: f.root });
    const copy = pastePlasticNodes(guided, guided, [f.root], null, 'index.html', { x: 500, y: 0 });
    expect(copy.doc.pages[0]!.guides).toHaveLength(2);
    expect(copy.doc.pages[0]!.guides?.[1]).toMatchObject({ frame: copy.ids[0], value: 16 });
    expect(copy.doc.pages[0]!.guides?.[1]?.id).not.toBe('frame-guide');
    const page = addPage(copy.doc, 'Other');
    const target = instantiate(page.doc, { tag: 'main', className: 'destination' });
    const placed = setFrame(insertRoot(target.doc, page.file, 0, target.id), target.id, { x: 0, y: 0 });
    const moved = moveLayers(placed, [f.root], target.id, 'after');
    expect(moved.pages.find((p) => p.file === 'index.html')!.guides?.some((g) => g.id === 'frame-guide')).toBe(false);
    expect(moved.pages.find((p) => p.file === page.file)!.guides).toContainEqual({ id: 'frame-guide', axis: 'x', value: 16, frame: f.root });
  });
});
