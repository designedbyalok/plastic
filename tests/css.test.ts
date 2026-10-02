import { describe, expect, it } from 'vitest';
import { parseDeclarations, parseStyleSheet, serializeStyleSheet, slugifyClassName } from '../src/document/css';

describe('styles.css', () => {
  it('round-trips class rules', () => {
    const sheet = { rules: { button: { padding: '10px 16px', 'border-radius': '8px' }, empty: {} }, preserved: '' };
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toEqual(sheet);
  });

  it('keeps non-class rules verbatim', () => {
    const css = ':root { --brand: #3b6cf6; }\n@media (max-width: 600px) { .card { padding: 8px; } }\n.card { color: red; }';
    const sheet = parseStyleSheet(css);
    expect(sheet.rules).toEqual({ card: { color: 'red' } });
    expect(sheet.preserved).toContain(':root { --brand: #3b6cf6; }');
    expect(sheet.preserved).toContain('@media (max-width: 600px) { .card { padding: 8px; } }');
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toEqual(sheet);
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
