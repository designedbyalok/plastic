/** Responsive and interaction overrides remain ordinary CSS, parsed and edited with PostCSS. */
import postcss, { type Root, type Rule } from 'postcss';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import { parseDeclarations, parseStyleSheet, serializeStyleSheet } from './css.ts';
import { ensurePrimaryClass } from './ops.ts';
import { getElement } from './tree.ts';
import type { Declarations, DesignDocument, NodeId, StyleSheet } from './types.ts';

export const STYLE_STATES = ['default', 'hover', 'focus', 'focus-visible', 'active', 'disabled'] as const;
export interface StyleVariant {
  readonly maxWidth: number | null;
  readonly state: (typeof STYLE_STATES)[number];
}
export interface StylePreview extends StyleVariant {
  readonly id: NodeId;
}

export const BASE_VARIANT: StyleVariant = { maxWidth: null, state: 'default' };
const parse = (css: string) => safeParse(css) as Root;
const selector = (cls: string, variant: StyleVariant) =>
  `.${cls}${variant.state === 'default' ? '' : `:${variant.state}`}`;
const media = (variant: StyleVariant) => `(max-width: ${variant.maxWidth}px)`;
const widthOf = (params: string) => /^\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i.exec(params)?.[1];

function matches(rule: Rule, cls: string, variant: StyleVariant): boolean {
  if (rule.selector !== selector(cls, variant)) return false;
  const parent = rule.parent;
  return variant.maxWidth === null
    ? parent?.type === 'root'
    : parent?.type === 'atrule' &&
        parent.name.toLowerCase() === 'media' &&
        parent.parent?.type === 'root' &&
        Number(widthOf(parent.params)) === variant.maxWidth;
}

const cache = new WeakMap<StyleSheet, Root>();
function ast(sheet: StyleSheet): Root {
  let root = cache.get(sheet);
  if (!root) {
    root = parse(serializeStyleSheet(sheet));
    cache.set(sheet, root);
  }
  return root;
}

export function variantDeclarations(sheet: StyleSheet, cls: string, variant: StyleVariant): Declarations {
  const out: Record<string, string> = Object.create(null);
  ast(sheet).walkRules((rule) => {
    if (!matches(rule, cls, variant)) return;
    for (const d of rule.nodes)
      if (d.type === 'decl') {
        if (!out[d.prop]?.endsWith(' !important') || d.important)
          out[d.prop] = `${d.value}${d.important ? ' !important' : ''}`;
      }
  });
  return out;
}

/** Imported simple max-width breakpoints appear alongside the presets in the inspector. */
export function variantWidths(sheet: StyleSheet): number[] {
  const widths = new Set<number>();
  ast(sheet).walkAtRules('media', (rule) => {
    const width = widthOf(rule.params);
    if (width && rule.parent?.type === 'root') widths.add(Number(width));
  });
  return [...widths].sort((a, b) => a - b);
}

export function setVariantDeclaration(
  doc: DesignDocument,
  id: NodeId,
  variant: StyleVariant,
  prop: string,
  value: string | null,
): DesignDocument {
  const el = getElement(doc, id);
  if (!el || !/^--?[a-z][a-z0-9-]*$|^[a-z][a-z0-9-]*$/i.test(prop)) return doc;
  if (variant.maxWidth !== null && (!Number.isFinite(variant.maxWidth) || variant.maxWidth <= 0)) return doc;
  if (!STYLE_STATES.includes(variant.state)) return doc;
  if (!el.classes[0] && !value) return doc;
  const ensured = ensurePrimaryClass(doc, id, el.tag);
  const root = ast(ensured.doc.styles).clone();
  const rules: Rule[] = [];
  root.walkRules((rule) => {
    if (matches(rule, ensured.className, variant)) rules.push(rule);
  });
  const declarations = rules.flatMap((r) => r.nodes.filter((d) => d.type === 'decl' && d.prop === prop));
  if (!value?.trim()) {
    if (!declarations.length) return doc;
    declarations.forEach((d) => d.remove());
  } else {
    const parsed = parseDeclarations(`${prop}:${value}`)[prop];
    if (!parsed) return doc;
    const important = /\s*!important\s*$/i.test(parsed);
    const nextValue = parsed.replace(/\s*!important\s*$/i, '');
    const last = declarations.at(-1);
    if (last?.type === 'decl') {
      last.value = nextValue;
      last.important = important;
      if (!important)
        declarations.forEach((d) => {
          if (d.type === 'decl') d.important = false;
        });
    } else {
      let rule = rules.at(-1);
      if (!rule) {
        rule = postcss.rule({ selector: selector(ensured.className, variant) });
        rule.raws.before = '\n\n';
        if (variant.maxWidth === null) root.append(rule);
        else {
          rule.raws.before = '\n  ';
          const contexts = root.nodes.filter(
            (n) => n.type === 'atrule' && n.name === 'media' && Number(widthOf(n.params)) === variant.maxWidth,
          );
          const context = contexts.at(-1) ?? postcss.atRule({ name: 'media', params: media(variant) });
          if (!context.parent) {
            context.raws.before = '\n\n';
            context.raws.after = '\n';
            root.append(context);
          }
          if (context.type === 'atrule') context.append(rule);
        }
      }
      const decl = postcss.decl({ prop, value: nextValue, important });
      decl.raws.before = variant.maxWidth === null ? '\n  ' : '\n    ';
      decl.raws.between = ': ';
      rule.raws.after = variant.maxWidth === null ? '\n' : '\n  ';
      rule.raws.semicolon = true;
      rule.append(decl);
    }
  }
  const source = root.toString();
  if (source === serializeStyleSheet(doc.styles) && ensured.doc === doc) return doc;
  return { ...ensured.doc, styles: parseStyleSheet(source) };
}

/** State simulation changes only the canvas stylesheet. Export and autosave use the original. */
const previewCache = new WeakMap<StyleSheet, Map<string, string>>();
export function previewVariantCss(sheet: StyleSheet, cls: string, preview: StylePreview): string {
  if (preview.state === 'default') return serializeStyleSheet(sheet);
  const key = JSON.stringify([cls, preview.id, preview.state]);
  const cached = previewCache.get(sheet)?.get(key);
  if (cached !== undefined) return cached;
  const root = ast(sheet).clone();
  root.walkRules((rule) => {
    rule.selector = selectorParser((selectors) =>
      selectors.walkPseudos((pseudo) => {
        if (pseudo.value !== `:${preview.state}` || pseudo.parent?.type !== 'selector') return;
        // Force only the selected element's state, including descendant and comma selectors.
        const compound = pseudo.parent.nodes;
        const index = compound.indexOf(pseudo);
        let start = index,
          end = index;
        while (start > 0 && compound[start - 1]?.type !== 'combinator') start--;
        while (end + 1 < compound.length && compound[end + 1]?.type !== 'combinator') end++;
        if (!compound.slice(start, end + 1).some((n) => n.type === 'class' && n.value === cls)) return;
        pseudo.replaceWith(
          selectorParser.attribute({
            attribute: 'data-pl-id',
            operator: '=',
            value: preview.id,
            quoteMark: '"',
            raws: { value: `"${preview.id}"` },
          }),
        );
      }),
    ).processSync(rule.selector);
  });
  const css = root.toString();
  const variants = previewCache.get(sheet) ?? new Map<string, string>();
  variants.set(key, css);
  previewCache.set(sheet, variants);
  return css;
}
