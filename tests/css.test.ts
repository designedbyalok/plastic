import { describe, expect, it } from 'vitest';
import { parseDeclarations, parseStyleSheet, serializeStyleSheet, slugifyClassName } from '../src/document/css';

describe('styles.css', () => {
  it('round-trips class rules', () => {
    const sheet = { rules: { button: { padding: '10px 16px', 'border-radius': '8px' }, empty: {} }, preserved: '', preservedAfter: '' };
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toMatchObject(sheet);
  });

  it('keeps non-class rules verbatim', () => {
    const css = ':root { --brand: #3b6cf6; }\n@media (max-width: 600px) { .card { padding: 8px; } }\n.card { color: red; }';
    const sheet = parseStyleSheet(css);
    expect(sheet.rules).toEqual({ card: { color: 'red' } });
    expect(sheet.preserved).toContain(':root { --brand: #3b6cf6; }');
    expect(sheet.preserved).toContain('@media (max-width: 600px) { .card { padding: 8px; } }');
    expect(sheet.preservedAfter).toBe('');
    expect(parseStyleSheet(serializeStyleSheet(sheet))).toMatchObject(sheet);
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

describe('formatted CSS values', () => {
  it('collapses whitespace a formatter wraps into values, keeping strings', async () => {
    const { parseDeclarations } = await import('../src/document/css.ts');
    expect(parseDeclarations('font-family: Inter,\n    system-ui,\n    "Segoe  UI",\n    sans-serif; content: "a  b"')).toEqual({
      'font-family': 'Inter, system-ui, "Segoe  UI", sans-serif',
      content: '"a  b"',
    });
  });
});

describe('source fidelity', () => {
  it('preserves interleaved media rules, comments and duplicate declarations exactly', () => {
    const css = '/* keep */\n.card { display: -webkit-box; display: flex; color: red }\n@media (min-width:1px) { .card { color:blue } }\n.card { color:green }\n';
    expect(serializeStyleSheet(parseStyleSheet(css))).toBe(css);
  });

  it('keeps an earlier important declaration effective', () => {
    const css = '.card { color:red !important } .card { color:green }';
    expect(parseStyleSheet(css).rules.card?.color).toBe('red !important');
    expect(serializeStyleSheet(parseStyleSheet(css))).toBe(css);
  });

  it('patches the final class declaration without moving a media rule', () => {
    const sheet = parseStyleSheet('.card { color:red } @media print { .card { color:blue } } .card { color:green }');
    const out = serializeStyleSheet({ ...sheet, rules: { card: { color: 'purple' } } });
    expect(out).toContain('@media print { .card { color:blue } } .card { color:purple }');
  });

  it('removes every duplicate of a deleted property without removing unrelated fallbacks', () => {
    const sheet = parseStyleSheet('.card { display: -webkit-box; display:flex; color:red !important } .card { color:green }');
    const out = serializeStyleSheet({ ...sheet, rules: { card: { display: 'flex' } } });
    expect(out).not.toContain('color:');
    expect(out).toContain('display: -webkit-box; display:flex');
  });

  it('an explicit edit can remove importance and still win over later declarations', () => {
    const sheet = parseStyleSheet('.card { color:red !important } .card { color:green }');
    const out = serializeStyleSheet({ ...sheet, rules: { card: { color: 'purple' } } });
    expect(out).not.toContain('!important');
    expect(parseStyleSheet(out).rules.card?.color).toBe('purple');
  });

  it('renames classes structurally in states, media rules and complex selectors', async () => {
    const { renameStyleClass } = await import('../src/document/css.ts');
    const css = '.card {color:red} .card:hover, .card > .card-title { color:blue } @media print { .card:focus {color:black} }';
    const out = serializeStyleSheet(renameStyleClass(parseStyleSheet(css), 'card', 'panel'));
    expect(out).toContain('.panel:hover, .panel > .card-title');
    expect(out).toContain('.panel:focus');
  });

  it('keeps token override order and comments when editing a root token', async () => {
    const { parseTokenSheet, serializeTokenSheet } = await import('../src/document/css.ts');
    const css = '/* theme */ :root { --color-brand:red } [data-theme=dark] { --color-brand:blue } :root { --color-brand:green }';
    const sheet = parseTokenSheet(css);
    expect(serializeTokenSheet(sheet)).toBe(css);
    const out = serializeTokenSheet({ ...sheet, values: { 'color-brand': 'purple' } });
    expect(out).toContain('[data-theme=dark] { --color-brand:blue } :root { --color-brand:purple');
  });

  it('recovers partially typed CSS without throwing', () => {
    expect(() => serializeStyleSheet(parseStyleSheet('.card { color: red;'))).not.toThrow();
  });
});

it('supports class names that collide with JavaScript object properties', () => {
  const css = '.constructor {color:red} .__proto__ {color:blue}';
  const sheet = parseStyleSheet(css);
  expect(sheet.rules.constructor).toEqual({color:'red'});
  expect(sheet.rules.__proto__).toEqual({color:'blue'});
  expect(serializeStyleSheet(sheet)).toBe(css);
});
