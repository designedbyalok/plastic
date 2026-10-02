// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseStyleSheet, parseTokenSheet, serializeTokenSheet } from '../src/document/css';
import { instantiate } from '../src/document/factory';
import { insertRoot, setFrame, setStyleOnNodes } from '../src/document/ops';
import { addPage, movePage, nextPageName, removePage, renamePage } from '../src/document/pages';
import { renameToken, setToken, tokenKind, tokenKindForProperty, tokenReference, tokenUsage } from '../src/document/tokens';
import { el } from './helpers';
import { parseProject, serializeProject } from '../src/serialization';
import { frameSpec, starterDocument } from '../src/elements/insertables';

const meta = { viewport: null, collapsed: [], activePage: null };

describe('pages', () => {
  it('adds, renames, reorders and removes pages', () => {
    let doc = starterDocument();
    const added = addPage(doc, nextPageName(doc));
    doc = added.doc;
    expect(added.file).toBe('page-2.html');
    expect(doc.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2']);
    doc = renamePage(doc, added.file, 'Pricing');
    expect(doc.pages[1]).toMatchObject({ name: 'Pricing', file: 'page-2.html' });
    doc = movePage(doc, added.file, 0);
    expect(doc.pages.map((p) => p.file)).toEqual(['page-2.html', 'index.html']);
    const removed = removePage(doc, 'index.html');
    expect(removed.pages.map((p) => p.file)).toEqual(['page-2.html']);
    expect(Object.keys(removed.nodes)).toHaveLength(0);
    expect(removePage(removed, 'page-2.html')).toBe(removed);
  });

  it('saves one HTML file per page and reopens them in order', () => {
    let doc = starterDocument();
    const added = addPage(doc, 'Pricing');
    const made = instantiate(added.doc, frameSpec());
    doc = setFrame(insertRoot(made.doc, added.file, 0, made.id), made.id, { x: 0, y: 0 });
    const files = serializeProject(doc, { ...meta, activePage: added.file });
    expect(Object.keys(files).sort()).toEqual(['index.html', 'pricing.html', 'project.json', 'styles.css', 'tokens.css']);
    const reopened = parseProject(files);
    expect(reopened.doc.pages.map((p) => [p.file, p.name, p.roots.length])).toEqual([
      ['index.html', 'Page 1', 1],
      ['pricing.html', 'Pricing', 1],
    ]);
    expect(reopened.meta.activePage).toBe('pricing.html');
    expect(serializeProject(reopened.doc, reopened.meta)).toEqual(files);
  });

  it('treats any .html file in the folder as a page, keeping ids unique across pages', () => {
    const { doc } = parseProject({
      'index.html': '<body><div data-pl-id="dup"></div></body>',
      'about.html': '<body><div data-pl-id="dup"></div></body>',
    });
    expect(doc.pages.map((p) => p.file)).toEqual(['index.html', 'about.html']);
    const [a, b] = doc.pages.map((p) => p.roots[0]);
    expect(a).not.toBe(b);
  });
});

describe('tokens', () => {
  it('round-trips tokens.css and keeps other rules', () => {
    const css = ':root { --color-primary: #4f46e5; --spacing-4: 16px; }\n[data-theme="dark"] { --color-primary: #818cf8; }';
    const sheet = parseTokenSheet(css);
    expect(sheet.values).toEqual({ 'color-primary': '#4f46e5', 'spacing-4': '16px' });
    expect(sheet.preserved).toContain('[data-theme="dark"]');
    expect(parseTokenSheet(serializeTokenSheet(sheet))).toEqual(sheet);
  });

  it('moves :root variables out of styles.css for older projects', () => {
    const { doc } = parseProject({ 'index.html': '<body></body>', 'styles.css': ':root { --brand: #4f46e5; }\n.a { color: var(--brand); }' });
    expect(doc.tokens.values).toEqual({ brand: '#4f46e5' });
    expect(doc.styles.preserved).toBe('');
    expect(doc.styles.rules.a).toEqual({ color: 'var(--brand)' });
  });

  it('infers kinds from Tailwind-style prefixes and from properties', () => {
    expect(tokenKind('color-primary')).toBe('color');
    expect(tokenKind('font-weight-bold')).toBe('font-weight');
    expect(tokenKind('font-sans')).toBe('font');
    expect(tokenKind('text-lg')).toBe('text');
    expect(tokenKind('brand')).toBe('other');
    expect(tokenKindForProperty('background')).toBe('color');
    expect(tokenKindForProperty('border-color')).toBe('color');
    expect(tokenKindForProperty('padding-left')).toBe('spacing');
    expect(tokenKindForProperty('border-radius')).toBe('radius');
    expect(tokenKindForProperty('display')).toBeNull();
    expect(tokenReference('var(--color-primary)')).toBe('color-primary');
    expect(tokenReference('1px solid var(--color-primary)')).toBeNull();
  });

  it('renames a token everywhere it is used, without touching similar names', () => {
    let doc = starterDocument();
    const frame = doc.pages[0]!.roots[0]!;
    doc = setToken(setToken(doc, 'color-primary', '#4f46e5'), 'color-primary-dark', '#312e81');
    doc = setToken(doc, 'color-accent', 'var(--color-primary)');
    doc = setStyleOnNodes(doc, [frame], 'background', 'var(--color-primary)');
    doc = setStyleOnNodes(doc, [frame], 'border', '1px solid var(--color-primary-dark)');
    expect(tokenUsage(doc, 'color-primary')).toBe(1);
    const renamed = renameToken(doc, 'color-primary', 'color-brand');
    const rule = renamed.styles.rules[el(renamed, frame).classes[0]!]!;
    expect(rule.background).toBe('var(--color-brand)');
    expect(rule.border).toBe('1px solid var(--color-primary-dark)');
    expect(renamed.tokens.values['color-accent']).toBe('var(--color-brand)');
    expect(Object.keys(renamed.tokens.values)).toEqual(['color-brand', 'color-primary-dark', 'color-accent']);
    expect(renameToken(doc, 'color-primary', 'color-accent')).toBe(doc);
  });

  it('keeps styles.css class rules separate from tokens', () => {
    expect(parseStyleSheet('.a { color: red; }').rules).toEqual({ a: { color: 'red' } });
  });
});
