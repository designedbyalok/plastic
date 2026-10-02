import { describe, expect, it } from 'vitest';
import { parseDeclarations, parseStyleSheet, serializeStyleSheet, slugifyClassName } from '../src/document/css';

describe('styles.css', () => {
  it('round-trips class rules', () => {
    const sheet = { rules: { button: { padding: '10px 16px', 'border-radius': '8px' }, empty: {} }, preserved: '', preservedAfter: '' };
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toEqual(sheet);
  });

  it('keeps non-class rules verbatim', () => {
    const css = ':root { --brand: #3b6cf6; }\n@media (max-width: 600px) { .card { padding: 8px; } }\n.card { color: red; }';
    const sheet = parseStyleSheet(css);
    expect(sheet.rules).toEqual({ card: { color: 'red' } });
    expect(sheet.preserved).toContain(':root { --brand: #3b6cf6; }');
    expect(sheet.preserved).toContain('@media (max-width: 600px) { .card { padding: 8px; } }');
    expect(sheet.preservedAfter).toBe('');
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toEqual(sheet);
  });

  it('keeps rules after the class rules after them (cascade order)', () => {
    const css = ':root { --x: 1; }\n.card { color: red; }\n@media (max-width: 400px) { .card { color: blue; } }\n';
    const sheet = parseStyleSheet(css);
    expect(sheet.preserved).toBe(':root { --x: 1; }');
    expect(sheet.preservedAfter).toBe('@media (max-width: 400px) { .card { color: blue; } }');
    const out = serializeStyleSheet(sheet);
    expect(out.indexOf('.card {')).toBeLessThan(out.indexOf('@media'));
    expect(out.indexOf(':root')).toBeLessThan(out.indexOf('.card {'));
  });

  it('does not split on semicolons inside url() or strings', () => {
    const decls = parseDeclarations("background: url(data:image/png;base64,AAA=); content: 'a;b'; --Custom: 1");
    expect(decls).toEqual({ background: 'url(data:image/png;base64,AAA=)', content: "'a;b'", '--Custom': '1' });
  });

  it('makes valid class names from text', () => {
    expect(slugifyClassName('Login Form')).toBe('login-form');
    expect(slugifyClassName('3 columns')).toBe('el-3-columns');
    expect(slugifyClassName('!!!')).toBe('el');
  });
});
