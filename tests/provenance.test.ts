// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { diagnosticSheet, styleProvenance, variableReferences } from '../src/canvas/provenance.ts';
import { docFrom } from './helpers.ts';

const probe = (css: string, prop = 'color', rendered = css) =>
  diagnosticSheet([{ file: 'styles.css', original: css, rendered }], prop, '--probe', document);

describe('browser cascade diagnostics', () => {
  it('parses real variable functions, including fallbacks, without matching quoted text', () => {
    expect(variableReferences('linear-gradient(var(--a), var(/*name*/ --b, var(--fallback)))')).toEqual([
      '--a',
      '--b',
      '--fallback',
    ]);
    expect(variableReferences('url("var(--fake)") "var(--also-fake)" var(--real)')).toEqual(['--real']);
  });
  it('keeps selectors and grouping contexts with authored source locations', () => {
    const result = probe('.a{color:red}\n@media(max-width:768px){\n.a:hover{color:blue!important}\n}');
    expect(result.css).toContain('.a:hover');
    expect(result.css).toContain('@media(max-width:768px)');
    expect(result.css).toMatch(/--probe:\s*source-1\s*!important/);
    expect(result.sources.get('source-1')).toMatchObject({
      file: 'styles.css',
      line: 3,
      selector: '.a:hover',
      value: 'blue',
      important: true,
      contexts: ['@media (max-width:768px)'],
    });
  });
  it('keeps important fallback declaration precedence within a rule', () => {
    const result = probe('.a{color:red!important;color:blue;background:black}');
    expect(result.sources.get('source-0')?.value).toBe('red');
    expect(result.css).not.toContain('background:black');
    expect(result.css).not.toContain('color:blue');
  });
  it('lets native CSSOM expand shorthands and treats all as a reset', () => {
    const result = probe('.a{padding:10px 20px;padding-left:30px}.b{all:initial}', 'padding-left');
    expect(result.sources.get('source-0')).toMatchObject({ property: 'padding-left', value: '30px' });
    expect(result.sources.get('source-1')).toMatchObject({ property: 'all', value: 'initial' });
    expect(probe('.a{padding:10px 20px}', 'padding-left').sources.get('source-0')).toMatchObject({
      property: 'padding',
      value: '10px 20px',
    });
    expect(probe('.a{all:initial}', '--color-brand').sources.size).toBe(0);
  });
  it('keeps named layer order and preserves revert-layer behavior', () => {
    const result = probe('@layer base,theme; @layer base{.a{color:red}} @layer theme{.a{color:revert-layer}}');
    expect(result.css).toContain('@layer base,theme;');
    expect(result.css).toMatch(/--probe:\s*revert-layer/);
    expect(result.notes).toEqual([]);
  });
  it('maps forced preview selectors to the original authored selector', () => {
    const result = probe('.a:hover{color:red}', 'color', '.a[data-pl-id="a"]{color:red}');
    expect(result.css).toContain('.a[data-pl-id="a"]');
    expect(result.sources.get('source-0')?.selector).toBe('.a:hover');
  });
  it('does not load imports, fonts or keyframes from a diagnostic sheet', () => {
    const result = probe(
      '@import "external.css"; @font-face{font-family:Test;src:url(font.woff)} @keyframes fade{to{color:red}} @layer{.a{color:blue}}',
    );
    expect(result.css).not.toContain('@import');
    expect(result.css).not.toContain('url(');
    expect(result.css).not.toContain('@keyframes');
    expect(result.notes).toContain('Imported external styles are not traced.');
    expect(result.notes).toContain('Anonymous cascade layers cannot be traced reliably.');
  });
  it('falls back safely when native registered properties are unavailable', () => {
    const { doc } = docFrom({ tag: 'div' });
    const element = document.createElement('div');
    element.setAttribute('style', 'color: red; padding: 3px;');
    document.body.append(element);
    const before = element.getAttribute('style');
    const result = styleProvenance(doc, element, 'color');
    expect(result.computed).toBe('rgb(255, 0, 0)');
    expect(result.notes).toContain('Source tracing is unavailable in this browser.');
    expect(element.getAttribute('style')).toBe(before);
    expect(document.querySelector('[data-plastic-probe]')).toBeNull();
    element.remove();
  });
});
