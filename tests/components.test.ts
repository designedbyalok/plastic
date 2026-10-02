// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canDefineComponent,
  defineComponent,
  detachComponent,
  instantiateComponent,
  synchronizeComponents,
} from '../src/document/components';
import { duplicateNodes, insertChild, removeNodes, setAttribute, setText } from '../src/document/ops';
import { instantiate } from '../src/document/factory';
import { getElement, textContent } from '../src/document/tree';
import { parseProject, serializeProject } from '../src/serialization';
import { serializeHTML } from '../src/serialization/html';
import { ProjectSync } from '../src/editor/projectSync';
import type { ProjectStorage } from '../src/serialization/storage';
import { useEditor } from '../src/editor/store';
import { docFrom, el } from './helpers';

const meta = { viewport: null, collapsed: [], activePage: null };
function fixture() {
  const made = docFrom({
    tag: 'article',
    className: 'card',
    children: [
      { tag: 'h2', className: 'heading', children: ['Main title'] },
      { tag: 'button', attrs: { type: 'button', title: 'Action' }, children: ['Buy now'] },
    ],
  });
  const defined = defineComponent(made.doc, made.root, 'Card');
  const copy = instantiateComponent(defined, made.root, 'index.html', made.root);
  const doc = copy.doc,
    root = made.root,
    instance = copy.id!;
  const heading = el(doc, root).children[0]!,
    button = el(doc, root).children[1]!;
  const ih = doc.components!.instances[instance]!.elements[heading]!;
  const ib = doc.components!.instances[instance]!.elements[button]!;
  return { doc, root, instance, heading, button, ih, ib };
}

describe('reusable HTML components', () => {
  it('creates shared styles with unique node identities and ordinary HTML', () => {
    const { doc, root, instance } = fixture();
    expect(el(doc, root).classes).toEqual(el(doc, instance).classes);
    expect(el(doc, root).children).not.toEqual(el(doc, instance).children);
    const html = serializeHTML(doc, doc.pages[0]!, { ids: false });
    expect(html).not.toContain('component');
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(synchronizeComponents(doc)).toBe(doc);
  });
  it('updates untouched text and attributes, preserves overrides across repeated edits', () => {
    const f = fixture();
    let doc = setText(f.doc, f.ih, 'Local title');
    doc = setAttribute(doc, f.ib, 'title', 'Local action');
    doc = synchronizeComponents(
      setText(setAttribute(doc, f.button, 'title', 'Main action'), f.heading, 'Updated title'),
    );
    expect(textContent(doc, f.ih)).toBe('Local title');
    expect(el(doc, f.ib).attrs.title).toBe('Local action');
    doc = synchronizeComponents(setText(doc, f.button, 'Purchase'));
    expect(textContent(doc, f.ib)).toBe('Purchase');
    expect(textContent(doc, f.ih)).toBe('Local title');
  });
  it('merges new structure while retaining instance additions and deletions', () => {
    const f = fixture();
    let doc = removeNodes(f.doc, [f.ib]);
    let added = instantiate(doc, { tag: 'p', children: ['Local extra'] });
    doc = insertChild(added.doc, f.instance, 1, added.id);
    added = instantiate(doc, { tag: 'small', children: ['Main extra'] });
    doc = synchronizeComponents(insertChild(added.doc, f.root, 2, added.id));
    expect(el(doc, f.instance).children).not.toContain(f.ib);
    expect(textContent(doc, f.instance)).toContain('Local extra');
    expect(textContent(doc, f.instance)).toContain('Main extra');
    doc = synchronizeComponents(setAttribute(doc, f.button, 'title', 'Again'));
    expect(el(doc, f.instance).children).not.toContain(f.ib);
  });
  it('removes unchanged source children but retains locally edited deleted subtrees', () => {
    const f = fixture();
    let doc = setText(f.doc, f.ih, 'Retain me');
    doc = synchronizeComponents(removeNodes(doc, [f.heading, f.button]));
    expect(getElement(doc, f.ih)).toBeDefined();
    expect(textContent(doc, f.ih)).toBe('Retain me');
    expect(getElement(doc, f.ib)).toBeUndefined();
  });
  it('survives saves and reloads with text overrides and stable element mapping', () => {
    const f = fixture();
    const saved = serializeProject(setText(f.doc, f.ih, 'Local title'), meta);
    let doc = parseProject(saved).doc;
    doc = synchronizeComponents(setText(doc, f.button, 'Reload update'));
    expect(textContent(doc, f.ib)).toBe('Reload update');
    expect(textContent(doc, f.ih)).toBe('Local title');
    expect(parseProject(serializeProject(doc, meta)).doc.components).toEqual(doc.components);
  });
  it('propagates external source edits when loading files', () => {
    const f = fixture();
    const files = serializeProject(f.doc, meta);
    files['index.html'] = files['index.html']!.replace('Main title', 'Agent title');
    const doc = parseProject(files).doc;
    expect(textContent(doc, f.ih)).toBe('Agent title');
  });
  it('detaches deleted mains and explicit links without deleting visible instances', () => {
    const f = fixture();
    expect(el(detachComponent(f.doc, f.instance), f.instance)).toEqual(el(f.doc, f.instance));
    const doc = synchronizeComponents(removeNodes(f.doc, [f.root]));
    expect(doc.components!.instances).toEqual({});
    expect(textContent(doc, f.instance)).toBe('Main titleBuy now');
    expect(detachComponent(f.doc, f.root).components!.instances).toEqual({});
  });
  it('duplicates an instance as another linked instance', () => {
    const f = fixture();
    const result = duplicateNodes(f.doc, [f.instance]);
    const copy = result.ids[0]!;
    const doc = synchronizeComponents(setText(result.doc, f.heading, 'Duplicate update'));
    expect(doc.components!.instances[copy]!.source).toBe(f.root);
    expect(textContent(doc, copy)).toContain('Duplicate update');
    expect(el(doc, copy).classes).toEqual(el(doc, f.instance).classes);
  });
  it('supports multiple pages and prevents nested/recursive component links', () => {
    const f = fixture();
    expect(canDefineComponent(f.doc, f.heading)).toBe(false);
    expect(canDefineComponent(f.doc, f.instance)).toBe(false);
    const doc = { ...f.doc, pages: [...f.doc.pages, { file: 'two.html', name: 'Two', roots: [] }] };
    const copy = instantiateComponent(doc, f.root, 'two.html');
    expect(copy.doc.pages[1]!.roots).toEqual([copy.id]);
    expect(instantiateComponent(doc, f.root, 'index.html', f.heading).id).toBeNull();
  });
  it('records propagation in one undo step, including gestures and cancel', () => {
    const f = fixture();
    const s = () => useEditor.getState();
    s().load(f.doc);
    s().apply('Edit main', (d) => setText(d, f.heading, 'Changed'));
    expect(textContent(s().doc, f.ih)).toBe('Changed');
    s().undo();
    expect(textContent(s().doc, f.ih)).toBe('Main title');
    s().redo();
    expect(textContent(s().doc, f.ih)).toBe('Changed');
    s().begin();
    s().preview((d) => setText(d, f.heading, 'Preview'));
    expect(textContent(s().doc, f.ih)).toBe('Preview');
    s().cancel();
    expect(textContent(s().doc, f.ih)).toBe('Changed');
    s().begin();
    s().preview((d) => setText(d, f.heading, 'Commit'));
    s().commit('Gesture');
    s().undo();
    expect(textContent(s().doc, f.ih)).toBe('Changed');
  });
  it('updates table rows and SVG groups without losing their namespace or wrappers', () => {
    for (const spec of [
      {
        tag: 'table',
        children: [{ tag: 'tbody', children: [{ tag: 'tr', children: [{ tag: 'td', children: ['Cell'] }] }] }],
      },
      {
        tag: 'svg',
        attrs: { viewBox: '0 0 100 100' },
        children: [{ tag: 'g', children: [{ tag: 'path', attrs: { d: 'M0 0 L10 10' } }] }],
      },
    ]) {
      const made = docFrom(spec);
      const source =
        spec.tag === 'table'
          ? el(made.doc, el(made.doc, made.root).children[0]).children[0]!
          : el(made.doc, made.root).children[0]!;
      const defined = defineComponent(made.doc, source, 'Structure');
      const copy = instantiateComponent(defined, source, 'index.html', source);
      const sourceChild = el(copy.doc, source).children[0]!;
      const instanceChild = copy.doc.components!.instances[copy.id!]!.elements[sourceChild]!;
      const doc = synchronizeComponents(setAttribute(copy.doc, sourceChild, 'data-check', 'updated'));
      expect(el(doc, instanceChild).attrs['data-check']).toBe('updated');
      expect(el(doc, copy.id!).tag).toBe(spec.tag === 'table' ? 'tr' : 'g');
      expect(parseProject(serializeProject(doc, meta)).doc.components!.instances[copy.id!]).toBeDefined();
    }
  });
  it('resets overrides and local additions without changing the instance root or its frame', () => {
    const f = fixture();
    const added = instantiate(setText(f.doc, f.ih, 'Override'), { tag: 'p', children: ['Local'] });
    const local = insertChild(added.doc, f.instance, 1, added.id);
    const doc = synchronizeComponents(local, f.instance);
    expect(textContent(doc, f.ih)).toBe('Main title');
    expect(getElement(doc, added.id)).toBeUndefined();
    expect(doc.frames[f.instance]).toEqual(f.doc.frames[f.instance]);
    expect(el(doc, f.instance).children).toEqual(el(f.doc, f.instance).children);
  });
  it('ignores malformed metadata and preserves the HTML', () => {
    const f = fixture();
    const files = serializeProject(f.doc, meta);
    const json = JSON.parse(files['project.json']!);
    json.components.instances[f.instance].elements = { [f.root]: f.instance, [f.heading]: f.instance };
    files['project.json'] = JSON.stringify(json);
    const doc = parseProject(files).doc;
    expect(doc.components!.instances).toEqual({});
    expect(textContent(doc, f.instance)).toBe('Main titleBuy now');
  });
  it('duplicates a main as an independent definition and leaves existing links intact', () => {
    const f = fixture();
    const copy = duplicateNodes(f.doc, [f.root]);
    expect(copy.doc.components!.definitions[copy.ids[0]!]).toBe('Card copy');
    const doc = synchronizeComponents(setText(copy.doc, f.heading, 'Only original'));
    expect(textContent(doc, f.instance)).toContain('Only original');
    expect(textContent(doc, copy.ids[0]!)).toContain('Main title');
  });
  it('saves propagated instances after a plain external HTML edit instead of marking them saved early', async () => {
    const f = fixture();
    const baseline = serializeProject(f.doc, meta);
    let state = { files: baseline, revision: 0, busy: false };
    const writes: Record<string, string>[] = [];
    let dirty = false;
    const storage: ProjectStorage = {
      id: 'test',
      location: 'test',
      assetBase: null,
      load: async () => baseline,
      save: async (files) => {
        writes.push({ ...files });
      },
      onExternalChange: () => () => {},
    };
    const sync = new ProjectSync(storage, baseline, {
      read: () => state,
      apply: (files) => {
        const parsed = parseProject(files);
        state = { files: serializeProject(parsed.doc, parsed.meta), revision: state.revision + 1, busy: false };
      },
      dirty: () => {
        dirty = true;
      },
      status: () => {},
    });
    const incoming = { ...baseline, 'index.html': baseline['index.html']!.replace('Main title', 'External title') };
    const raw = parseProject(incoming, { syncComponents: false });
    sync.receive(serializeProject(raw.doc, raw.meta, { syncComponents: false }));
    expect(dirty).toBe(true);
    await sync.save();
    expect(writes).toHaveLength(1);
    expect(writes[0]!['index.html']!.match(/External title/g)).toHaveLength(2);
    sync.close();
  });
});
