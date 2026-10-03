// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { frameDesign, parseFrameLink } from '../src/serialization/frame';
import { parseStyleSheet } from '../src/document/css';
import { setName } from '../src/document/ops';
import { docFrom } from './helpers';

describe('frame links and AI design context', () => {
  it('resolves stable frame links and rejects other resources or unsafe project paths', () => {
    expect(parseFrameLink('https://useplastic.app/file/demo?frame=abc123')).toEqual({ file: 'demo', frame: 'abc123' });
    expect(parseFrameLink('/file/demo?frame=abc123')).toEqual({ file: 'demo', frame: 'abc123' });
    expect(() => parseFrameLink('/file/demo')).toThrow();
    expect(() => parseFrameLink('/file/%2E%2E%2Fsecret?frame=abc')).toThrow();
    expect(() => parseFrameLink('https://other.example/api/data?frame=abc')).toThrow();
  });
  it('includes the complete subtree, semantic attributes, SVG and the original ordered cascade', () => {
    const f = docFrom({ tag: 'section', className: 'hero', children: [
      { tag: 'h1', children: ['Build ', { tag: 'em', children: ['better'] }] },
      { tag: 'img', attrs: { src: 'assets/hero.png', alt: 'Hero' } },
      { tag: 'svg', attrs: { viewBox: '0 0 10 10' }, children: [{ tag: 'path', attrs: { d: 'M0 0L10 10' } }] },
    ] });
    const css = '@font-face {font-family:Demo;src:url(assets/demo.woff2)}\n.hero {display:flex;gap:24px}\n.hero em {color:red}\n@media(max-width:600px){.hero {flex-direction:column}}';
    const doc = setName({ ...f.doc, styles: parseStyleSheet(css) }, f.root, 'Landing hero');
    const context = frameDesign(doc, f.root);
    expect(context.frame.name).toBe('Landing hero');
    expect(context.nodes).toHaveLength(8);
    expect(context.html).toContain('<em');
    expect(context.html).toContain('assets/hero.png');
    expect(context.html).toContain('M0 0L10 10');
    expect(context.css).toContain('@font-face');
    expect(context.css).toContain('.hero em');
    expect(context.css).toContain('@media');
    const child = context.nodes.find((n) => n.kind === 'element' && n.tag === 'h1')!;
    const nested = frameDesign(doc, child.id);
    expect(nested.frame.id).toBe(child.id);
    expect(nested.contextHtml).toContain('<section');
    expect(nested.ancestors.map((node) => node.id)).toContain(f.root);
    expect(() => frameDesign(doc, 'missing')).toThrow();
  });
});
