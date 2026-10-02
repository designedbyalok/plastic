// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { mergeFiles } from '../src/editor/merge.ts';

const html = (body: string) => `<!doctype html><html><head><title>Design</title></head><body>${body}</body></html>`;
const mergeHTML = (b: string, l: string, r: string) =>
  new DOMParser().parseFromString(
    mergeFiles({ 'index.html': html(b) }, { 'index.html': html(l) }, { 'index.html': html(r) })['index.html']!,
    'text/html',
  );
const css = (b: string, l: string, r: string) =>
  postcss.parse(mergeFiles({ 'styles.css': b }, { 'styles.css': l }, { 'styles.css': r })['styles.css']!);

describe('automatic web-file merging', () => {
  it('merges independent inline styles, class additions, and words in a text node', () => {
    const b = '<p data-pl-id="a" class="base" style="color:red;padding:1px">Hello world</p>';
    const l = b
      .replace('class="base"', 'class="base local"')
      .replace('color:red', 'color:green')
      .replace('Hello', 'Welcome');
    const r = b
      .replace('class="base"', 'class="base remote"')
      .replace('padding:1px', 'padding:4px')
      .replace('world', 'friend');
    const el = mergeHTML(b, l, r).querySelector('p')!;
    expect(el.textContent).toBe('Welcome friend');
    expect(el.className).toBe('base local remote');
    expect(el.style.color).toBe('green');
    expect(el.style.padding).toBe('4px');
  });
  it('merges text and attribute edits on the same stable element', () => {
    const dom = mergeHTML(
      '<h1 data-pl-id="a" title="old">Hello</h1>',
      '<h1 data-pl-id="a" title="old">Local</h1>',
      '<h1 data-pl-id="a" title="new">Hello</h1>',
    );
    expect(dom.querySelector('h1')?.textContent).toBe('Local');
    expect(dom.querySelector('h1')?.title).toBe('new');
  });
  it('keeps local same-field edits and merges independent incoming elements', () => {
    const b = '<p data-pl-id="a">Old</p><p data-pl-id="b">Other</p>';
    const dom = mergeHTML(b, b.replace('Old', 'Local'), b.replace('Old', 'Remote').replace('Other', 'Updated'));
    expect(dom.body.textContent?.trim()).toBe('LocalUpdated');
  });
  it('retains concurrent insertions once each in the same container', () => {
    const dom = mergeHTML(
      '<div data-pl-id="a"></div>',
      '<div data-pl-id="a"><p data-pl-id="l">Local</p></div>',
      '<div data-pl-id="a"><p data-pl-id="r">Remote</p></div>',
    );
    expect(dom.querySelector('div')?.textContent).toBe('LocalRemote');
    expect(dom.querySelectorAll('p').length).toBe(2);
  });
  it('merges moves with edits and does not duplicate the moved element', () => {
    const b = '<div data-pl-id="a"><p data-pl-id="p">Old</p></div><section data-pl-id="b"></section>';
    const l = '<div data-pl-id="a"></div><section data-pl-id="b"><p data-pl-id="p">Old</p></section>';
    const dom = mergeHTML(b, l, b.replace('Old', 'New'));
    expect(dom.querySelector('section p')?.textContent).toBe('New');
    expect(dom.querySelectorAll('p').length).toBe(1);
  });
  it('applies incoming deletion of unchanged nodes alongside a local edit', () => {
    const b = '<p data-pl-id="a">Old</p><p data-pl-id="b">Other</p>';
    const dom = mergeHTML(b, b.replace('Old', 'Local'), '<p data-pl-id="a">Old</p>');
    expect(dom.body.textContent?.trim()).toBe('Local');
  });
  it('retains a locally edited subtree when the incoming side deletes its container', () => {
    const b = '<div data-pl-id="a"><p data-pl-id="p">Old</p><span data-pl-id="s">Unchanged</span></div>';
    const dom = mergeHTML(b, b.replace('Old', 'Local'), '');
    expect(dom.querySelector('div p')?.textContent).toBe('Local');
    expect(dom.querySelector('div span')?.textContent).toBe('Unchanged');
  });
  it('keeps an intentional local deletion over an incoming edit', () => {
    const dom = mergeHTML('<p data-pl-id="a">Old</p>', '', '<p data-pl-id="a">Remote</p>');
    expect(dom.querySelector('p')).toBeNull();
  });
  it('repairs cycles from concurrent reparenting using the active structure', () => {
    const b = '<div data-pl-id="a"></div><div data-pl-id="b"></div>';
    const l = '<div data-pl-id="b"><div data-pl-id="a"></div></div>';
    const r = '<div data-pl-id="a"><div data-pl-id="b"></div></div>';
    const dom = mergeHTML(b, l, r);
    expect(dom.querySelectorAll('[data-pl-id]').length).toBe(2);
    expect(dom.querySelector('[data-pl-id="b"] > [data-pl-id="a"]')).not.toBeNull();
  });
  it('merges declarations in the same rule, preserving fallback order and nested overrides', () => {
    const b =
      '/* note */ .a { display: -webkit-box; display: flex; color: red; padding: 1px; } @media (width < 500px) { .a { color: blue; } }';
    const result = css(
      b,
      b.replace('padding: 1px', 'padding: 8px'),
      b.replace('color: red', 'color: green').replace('color: blue', 'color: purple'),
    );
    const values: string[] = [];
    result.walkDecls((d) => {
      values.push(`${d.prop}:${d.value}`);
    });
    expect(values).toEqual(['display:-webkit-box', 'display:flex', 'color:green', 'padding:8px', 'color:purple']);
    expect(result.toString()).toContain('/* note */');
  });
  it('preserves same-property local values while accepting incoming additions and deletions', () => {
    const result = css(
      '.a{color:red;padding:1px;margin:2px}',
      '.a{color:green;padding:1px;margin:2px}',
      '.a{color:blue;padding:4px;border:0}',
    );
    const declarations: Record<string, string> = {};
    result.walkDecls((d) => {
      declarations[d.prop] = d.value;
    });
    expect(declarations).toEqual({ color: 'green', padding: '4px', border: '0' });
  });
  it('merges deleting a fallback with changing the effective declaration', () => {
    const result = css(
      '.a{display:-webkit-box;display:flex}',
      '.a{display:flex}',
      '.a{display:-webkit-box;display:grid}',
    );
    const values: string[] = [];
    result.walkDecls('display', (d) => {
      values.push(d.value);
    });
    expect(values).toEqual(['grid']);
  });
  it('merges tokens by declaration while retaining theme overrides', () => {
    const b = ':root{--a:red;--b:1px} [data-theme="dark"]{--a:black}';
    const merged = mergeFiles(
      { 'tokens.css': b },
      { 'tokens.css': b.replace('--a:red', '--a:green') },
      { 'tokens.css': b.replace('--b:1px', '--b:8px') },
    );
    expect(merged['tokens.css']).toContain('--a:green;--b:8px');
    expect(merged['tokens.css']).toContain('--a:black');
  });
  it('merges page metadata by file and frame coordinates by field', () => {
    const b = { pages: [{ file: 'index.html', name: 'Home' }], canvas: { frames: { a: { x: 0, y: 0 } } } };
    const l = { pages: [{ file: 'index.html', name: 'Local' }], canvas: { frames: { a: { x: 20, y: 0 } } } };
    const r = {
      pages: [
        { file: 'index.html', name: 'Home' },
        { file: 'new.html', name: 'New' },
      ],
      canvas: { frames: { a: { x: 0, y: 30 } } },
    };
    const f = mergeFiles(
      { 'project.json': JSON.stringify(b) },
      { 'project.json': JSON.stringify(l) },
      { 'project.json': JSON.stringify(r) },
    );
    expect(JSON.parse(f['project.json']!)).toEqual({
      pages: [
        { file: 'index.html', name: 'Local' },
        { file: 'new.html', name: 'New' },
      ],
      canvas: { frames: { a: { x: 20, y: 30 } } },
    });
  });
});
