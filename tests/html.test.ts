// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../src/serialization';
import { parseHTML, serializeHTML } from '../src/serialization/html';
import { INSERTABLES, frameSpec } from '../src/elements/insertables';
import { instantiate } from '../src/document/factory';
import { insertChild } from '../src/document/ops';
import { docFrom, shape } from './helpers';

const meta = { viewport: { x: 10, y: 20, zoom: 0.5 }, collapsed: [], activePage: null };

describe('page HTML', () => {
  it('writes the semantic markup you would write by hand', () => {
    const { doc, root } = docFrom({
      tag: 'form',
      className: 'login-form',
      children: [
        { tag: 'h2', children: ['Sign in'] },
        { tag: 'label', children: ['Email', { tag: 'input', attrs: { type: 'email', placeholder: 'you@example.com', required: '' } }] },
        { tag: 'button', attrs: { type: 'submit' }, children: ['Continue'] },
      ],
    });
    const html = serializeHTML(doc, doc.pages[0]!, { ids: false });
    expect(html).toContain(
      [
        '    <form class="login-form">',
        '      <h2>Sign in</h2>',
        '      <label>Email<input type="email" placeholder="you@example.com" required></label>',
        '      <button type="submit">Continue</button>',
        '    </form>',
      ].join('\n'),
    );
    expect(serializeHTML(doc, doc.pages[0]!)).toContain(`data-pl-id="${root}"`);
    expect(html).toContain('<link rel="stylesheet" href="tokens.css">\n    <link rel="stylesheet" href="styles.css">');
  });

  it('round-trips every insertable through HTML and CSS', () => {
    let { doc, root } = docFrom(frameSpec());
    for (const item of INSERTABLES) {
      const made = instantiate(doc, item.spec());
      doc = insertChild(made.doc, root, 999, made.id);
    }
    const files = serializeProject(doc, meta);
    const reopened = parseProject(files);
    expect(reopened.doc.pages).toEqual(doc.pages);
    expect(shape(reopened.doc, root)).toEqual(shape(doc, root));
    expect(reopened.doc.styles).toMatchObject(doc.styles);
    expect(reopened.doc.frames).toEqual(doc.frames);
    expect(reopened.meta.viewport).toEqual(meta.viewport);
    // Saving again is stable (no drift between saves → clean git diffs).
    expect(serializeProject(reopened.doc, reopened.meta)).toEqual(files);
  });

  it('keeps inline text exactly, drops formatting whitespace', () => {
    const parsed = parseHTML('<body>\n  <p class="a">Hello <b>big</b> world</p>\n  <div>\n    <span>x</span>\n  </div>\n</body>');
    const [p, div] = parsed.roots.map((id) => parsed.nodes[id]!);
    expect(p?.kind === 'element' && p.children.map((c) => parsed.nodes[c]?.kind)).toEqual(['text', 'element', 'text']);
    expect(div?.kind === 'element' && div.children.length).toBe(1);
  });

  it('opens hand-written HTML: assigns missing and duplicate ids, skips scripts', () => {
    const parsed = parseHTML('<body><div data-pl-id="same"></div><div data-pl-id="same"></div><script>alert(1)</script></body>');
    expect(parsed.roots).toHaveLength(2);
    expect(new Set(parsed.roots).size).toBe(2);
    expect(Object.values(parsed.nodes).some((n) => n.kind === 'element' && n.tag === 'script')).toBe(false);
  });

  it('places roots without stored positions instead of stacking them', () => {
    const { doc } = parseProject({ 'index.html': '<body><main></main><section></section></body>' });
    const [a, b] = doc.pages[0]!.roots.map((id) => doc.frames[id]!);
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b!.x).toBeGreaterThan(0);
  });
});
