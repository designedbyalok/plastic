// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseStyleSheet, serializeStyleSheet } from '../src/document/css';
import { finishProject, parseProject, parseProjectAsync, serializeProject } from '../src/serialization';
import { docFrom } from './helpers';

it('reads a project page by page to the same document as parseProject', async () => {
  const { doc } = docFrom({ tag: 'main', children: [{ tag: 'section', children: [{ tag: 'p' }] }] });
  const files = serializeProject({ ...doc, pages: [...doc.pages, { file: 'two.html', name: 'Two', roots: [] }] }, { viewport: null, collapsed: [], activePage: null });
  const pages: number[] = [];
  const stored = await parseProjectAsync(files, (done) => pages.push(done));
  expect(pages).toEqual([1, 2]);
  expect(finishProject(stored)).toEqual(parseProject(files));
  expect(finishProject(stored, { syncComponents: false })).toEqual(parseProject(files, { syncComponents: false }));
});

it('serializes an unedited sheet as its source and patches only edited rules in a large one', () => {
  const css = Array.from({ length: 3000 }, (_, i) => `.c${i} {\n  color: red; /* keep */\n  color: blue;\n}`).join('\n\n') + '\n@media (min-width: 1px) { .c1 { color: green; } }\n';
  const sheet = parseStyleSheet(css);
  expect(serializeStyleSheet(sheet)).toBe(sheet.source);
  const edited = { ...sheet, rules: { ...sheet.rules, c7: { ...sheet.rules.c7, color: 'black', width: '4px' } } };
  const started = performance.now();
  const out = serializeStyleSheet(edited);
  expect(performance.now() - started).toBeLessThan(2000);
  // The fallback and comment stay; the winning declaration changes; others are untouched.
  expect(out).toContain('.c7 {\n  color: red; /* keep */\n  color: black;\n  width: 4px;\n}');
  expect(out).toContain('.c8 {\n  color: red; /* keep */\n  color: blue;\n}');
  expect(out).toContain('@media (min-width: 1px) { .c1 { color: green; } }');
  const { c9: _, ...rest } = sheet.rules;
  expect(serializeStyleSheet({ ...sheet, rules: rest })).not.toContain('.c9 {');
});
