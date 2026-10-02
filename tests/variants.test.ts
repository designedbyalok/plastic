import { describe, expect, it } from 'vitest';
import { parseStyleSheet, serializeStyleSheet } from '../src/document/css.ts';
import { renameClass } from '../src/document/ops.ts';
import {
  BASE_VARIANT,
  previewVariantCss,
  setVariantDeclaration,
  variantDeclarations,
  variantWidths,
} from '../src/document/variants.ts';
import { docFrom, el } from './helpers.ts';
import { useEditor } from '../src/editor/store.ts';

describe('responsive and state styles', () => {
  it('uses the existing undo history and keeps preview outside document revisions', () => {
    const { doc, root } = docFrom({ tag: 'button', className: 'cta' });
    const variant = { state: 'focus', maxWidth: 640 } as const;
    useEditor.getState().load(doc);
    const revision = useEditor.getState().revision;
    useEditor.setState({ stylePreview: { ...variant, id: root } });
    expect(useEditor.getState().revision).toBe(revision);
    expect(useEditor.getState().doc).toBe(doc);
    useEditor.getState().apply('Edit focus style', (d) => setVariantDeclaration(d, root, variant, 'color', 'red'));
    expect(variantDeclarations(useEditor.getState().doc.styles, 'cta', variant).color).toBe('red');
    useEditor.getState().undo();
    expect(variantDeclarations(useEditor.getState().doc.styles, 'cta', variant).color).toBeUndefined();
    useEditor.getState().redo();
    expect(variantDeclarations(useEditor.getState().doc.styles, 'cta', variant).color).toBe('red');
    useEditor.getState().load(doc);
    expect(useEditor.getState().stylePreview).toBeNull();
  });
  it('creates a primary class and ordinary media/state rules without changing base styles', () => {
    const { doc, root } = docFrom({ tag: 'button', children: ['Continue'] });
    const variant = { maxWidth: 768, state: 'hover' } as const;
    const next = setVariantDeclaration(doc, root, variant, 'color', 'var(--color-brand)');
    const cls = el(next, root).classes[0]!;
    const css = serializeStyleSheet(next.styles);
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain(`.${cls}:hover`);
    expect(variantDeclarations(next.styles, cls, variant).color).toBe('var(--color-brand)');
    expect(next.styles.rules[cls]?.color).toBeUndefined();
    expect(doc.styles).not.toBe(next.styles);
  });
  it('updates matching repeated rules without flattening cascade, fallbacks or other contexts', () => {
    const { doc, root } = docFrom({ tag: 'button', className: 'cta' });
    const source =
      '.cta{color:black} @media (max-width:768px){/* keep */.cta:hover{display:-webkit-box;display:flex;color:red!important}} .cta:hover{color:blue} @media (max-width: 768px){.cta:hover{color:green}} @supports(display:grid){.cta:hover{color:purple}}';
    const base = { ...doc, styles: parseStyleSheet(source) };
    const variant = { maxWidth: 768, state: 'hover' } as const;
    expect(variantDeclarations(base.styles, 'cta', variant).color).toBe('red !important');
    const next = setVariantDeclaration(base, root, variant, 'color', 'orange');
    const css = serializeStyleSheet(next.styles);
    expect(variantDeclarations(next.styles, 'cta', variant).color).toBe('orange');
    expect(css).toContain('/* keep */');
    expect(css).toContain('display:-webkit-box;display:flex');
    expect(css).toContain('.cta:hover{color:blue}');
    expect(css).toContain('@supports(display:grid){.cta:hover{color:purple}}');
    const removed = setVariantDeclaration(next, root, variant, 'color', null);
    expect(variantDeclarations(removed.styles, 'cta', variant).color).toBeUndefined();
    expect(removed.styles.rules.cta?.color).toBe('black');
  });
  it('supports custom breakpoint widths and preserves unrelated imported conditions', () => {
    const sheet = parseStyleSheet(
      '@media (max-width: 640px){.a{color:red}} @media (max-width: 910px){.a{color:blue}} @media (min-width: 1200px){.a{color:green}}',
    );
    expect(variantWidths(sheet)).toEqual([640, 910]);
  });
  it('writes defaults into base CSS and retains edits when a class is renamed', () => {
    const { doc, root } = docFrom({ tag: 'button', className: 'cta' });
    const next = setVariantDeclaration(doc, root, BASE_VARIANT, 'width', '100%');
    expect(next.styles.rules.cta?.width).toBe('100%');
    const hover = setVariantDeclaration(next, root, { maxWidth: null, state: 'hover' }, 'color', 'red');
    const renamed = renameClass(hover, 'cta', 'action');
    expect(variantDeclarations(renamed.styles, 'action', { maxWidth: null, state: 'hover' }).color).toBe('red');
  });
  it('simulates selected state at the original specificity across breakpoints without changing exports', () => {
    const sheet = parseStyleSheet(
      '.cta:hover,.other:hover{color:red} @media(max-width:768px){.cta:hover span{color:green}} .cta{color:blue}',
    );
    const before = serializeStyleSheet(sheet);
    const preview = previewVariantCss(sheet, 'cta', { id: 'a', state: 'hover', maxWidth: 375 });
    expect(preview).toContain('.cta[data-pl-id="a"]');
    expect(preview).toContain('.other:hover');
    expect(preview).toContain('.cta[data-pl-id="a"] span');
    expect(serializeStyleSheet(sheet)).toBe(before);
    expect(before).not.toContain('data-pl-id');
  });
  it('rejects invalid widths and removing an absent override does not create a class', () => {
    const { doc, root } = docFrom({ tag: 'button' });
    expect(setVariantDeclaration(doc, root, { maxWidth: -1, state: 'hover' }, 'color', 'red')).toBe(doc);
    expect(setVariantDeclaration(doc, root, BASE_VARIANT, 'color', null)).toBe(doc);
  });
});
