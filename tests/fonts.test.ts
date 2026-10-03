// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { bundledFontsReady, googleFontUrl, selectFont, WEB_FONT_OPTIONS } from '../src/document/fonts';
import { parseStyleSheet, serializeStyleSheet } from '../src/document/css';
import { parseProject, serializeProject } from '../src/serialization';
import { docFrom, el } from './helpers';
import { normalizeInterFonts } from '../src/document/fontNames';
import { insertable, INSERTABLES, DEFAULT_TEXT_FONT } from '../src/elements/insertables';

const meta = { viewport: null, collapsed: [], activePage: null };
describe('on-demand UI fonts', () => {
  it('defaults every semantic insert tool to Inter without changing its weight', () => {
    for (const item of INSERTABLES) expect(insertable(item.id)!.spec().style?.['font-family']).toBe(DEFAULT_TEXT_FONT);
    expect(insertable('button')!.spec().style?.['font-weight']).toBe('500');
  });
  it('normalizes Regular and Medium desktop faces, preserving explicit weights and custom faces', () => {
    const f = docFrom({ tag: 'div' });
    const doc = { ...f.doc, styles: parseStyleSheet('.regular {font-family: "Inter Regular", sans-serif} .medium {font-family: "Inter Medium"; font-weight: 400} .bold {font-family: "Inter Medium"; font-weight: 700}') };
    const normalized = normalizeInterFonts(doc);
    expect(normalized.styles.rules.regular).toMatchObject({ 'font-family': 'Inter, sans-serif', 'font-weight': '400' });
    expect(normalized.styles.rules.medium).toMatchObject({ 'font-family': 'Inter', 'font-weight': '500' });
    expect(normalized.styles.rules.bold!['font-weight']).toBe('700');
    const custom = { ...f.doc, styles: parseStyleSheet('@font-face {font-family: "Inter Medium"; src: url(custom.woff2)} .custom {font-family: "Inter Medium"}') };
    expect(normalizeInterFonts(custom)).toBe(custom);
  });
  it('normalizes token-backed Medium faces and remains stable after save/reload', () => {
    const f = docFrom({ tag: 'div', className: 'sample', style: { 'font-family': 'var(--font-ui)' } });
    const doc = { ...f.doc, tokens: { ...f.doc.tokens, values: { 'font-ui': '"Inter Medium", sans-serif' } } };
    const normalized = normalizeInterFonts(doc);
    expect(normalized.tokens.values['font-ui']).toBe('Inter, sans-serif');
    expect(normalized.styles.rules.sample!['font-weight']).toBe('500');
    expect(normalized.styles.rules.sample!['font-family']).toBe('var(--font-ui)');
    const roundtrip = parseProject(serializeProject(normalized, meta)).doc;
    expect(roundtrip.styles.rules.sample!['font-weight']).toBe('500');
  });
  it('adds only the selected family, keeps imports valid and survives reload/export', () => {
    const f = docFrom({ tag: 'h1', children: ['Font sample'] });
    expect(serializeStyleSheet(f.doc.styles)).not.toContain('fonts.googleapis.com');
    const option = WEB_FONT_OPTIONS.find((font) => font.label === 'DM Sans')!;
    const selected = selectFont(f.doc, [f.root], option.value);
    const css = serializeStyleSheet(selected.styles);
    expect(css.startsWith('@import')).toBe(true);
    expect(css).toContain(googleFontUrl('DM Sans'));
    expect(css).not.toContain(googleFontUrl('Geist'));
    expect(selected.styles.rules[el(selected, f.root).classes[0]!]!['font-family']).toBe(option.value);
    const again = selectFont(selected, [f.root], option.value);
    expect(serializeStyleSheet(again.styles).match(/@import/g)).toHaveLength(1);
    const saved = parseProject(serializeProject(selected, meta)).doc;
    expect(serializeStyleSheet(saved.styles)).toContain(googleFontUrl('DM Sans'));
  });
  it('avoids web requests for system fonts and honors bundled project fonts', () => {
    const f = docFrom({ tag: 'p', children: ['Text'] });
    const system = selectFont(f.doc, [f.root], 'system-ui, sans-serif');
    expect(serializeStyleSheet(system.styles)).not.toContain('@import');
    const doc = { ...f.doc, styles: parseStyleSheet('@font-face { font-family: "Inter"; src: url(assets/inter.woff2); }') };
    expect(serializeStyleSheet(selectFont(doc, [f.root], 'Inter, sans-serif').styles)).not.toContain('fonts.googleapis.com');
  });
  it('embeds the bundled Inter once it has loaded, with no web request', async () => {
    await bundledFontsReady;
    const f = docFrom({ tag: 'p', children: ['Text'] });
    const css = serializeStyleSheet(selectFont(f.doc, [f.root], 'Inter, sans-serif').styles);
    expect(css).toContain('@font-face');
    expect(css).toContain('data:font/woff2;base64,');
    expect(css).not.toContain('fonts.googleapis.com');
  });
  it('resolves selected font tokens without rewriting the token reference', () => {
    const f = docFrom({ tag: 'p' });
    const doc = { ...f.doc, tokens: { ...f.doc.tokens, values: { 'font-ui': '"Geist Mono", monospace' } } };
    const selected = selectFont(doc, [f.root], 'var(--font-ui)');
    expect(serializeStyleSheet(selected.styles)).toContain(googleFontUrl('Geist Mono'));
    expect(selected.styles.rules[el(selected, f.root).classes[0]!]!['font-family']).toBe('var(--font-ui)');
  });
});
