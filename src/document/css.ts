/** CSS parsing and source-preserving edits, powered by PostCSS. */
import postcss, { type Declaration, type Root, type Rule } from 'postcss';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import type { Declarations, StyleSheet, TokenSheet } from './types.ts';

// The safe parser returns a stylesheet root; its package types also allow Document.
const parseCss = (css: string): Root => safeParse(css) as Root;

export const EMPTY_SHEET: StyleSheet = { rules: {}, preserved: '', preservedAfter: '' };
const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const CLASS_SELECTOR = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)$/;
const HEADER =
  '/* Written by Plastic. Edit freely: class rules round-trip through the visual editor,\n   other rules are preserved as-is. */';
const TOKENS_HEADER =
  '/* Design tokens, written by Plastic. Use them in styles.css as var(--name).\n   Names follow the Tailwind v4 theme namespaces: color-, spacing-, radius-, font-, text-, … */';

export function isValidClassName(name: string): boolean {
  return CLASS_NAME.test(name);
}
export function slugifyClassName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return !slug ? 'el' : /^[a-z_]/.test(slug) ? slug : `el-${slug}`;
}

function classOf(node: Root['nodes'][number]): string | null {
  return node.type === 'rule' && node.nodes.every((n) => n.type === 'decl' || n.type === 'comment')
    ? (CLASS_SELECTOR.exec(node.selector)?.[1] ?? null)
    : null;
}
function valueOf(d: Declaration): string {
  return collapseWhitespace(d.value) + (d.important ? ' !important' : '');
}
function collect(rule: Rule, out: Record<string, string>): void {
  rule.nodes.forEach((d) => {
    if (d.type !== 'decl') return;
    const prop = d.prop.startsWith('--') ? d.prop : d.prop.toLowerCase();
    if (!out[prop]?.endsWith(' !important') || d.important) out[prop] = valueOf(d);
  });
}
export function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const rule = parseCss(`a{${body}}`).first;
  if (rule?.type === 'rule') collect(rule, out);
  return out;
}

export function collapseWhitespace(value: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < value.length) out += value[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (/\s/.test(ch)) {
      if (!out.endsWith(' ')) out += ' ';
    } else {
      out += ch;
    }
  }
  return out.trim();
}

export function serializeDeclarations(decls: Declarations, indent = '  '): string {
  return Object.entries(decls)
    .map(([prop, value]) => `${indent}${prop}: ${value};`)
    .join('\n');
}

/** Serialized sheets by identity (sheets are immutable). */
const styleCache = new WeakMap<StyleSheet, string>();

export function parseStyleSheet(css: string): StyleSheet {
  const rules: Record<string, Record<string, string>> = Object.create(null);
  const before: string[] = [],
    after: string[] = [];
  const root = parseCss(css);
  for (const node of root.nodes) {
    const name = classOf(node);
    if (name && node.type === 'rule') collect(node, (rules[name] ??= Object.create(null)));
    else if (node.type !== 'comment' || !node.text.startsWith('Written by Plastic.'))
      (Object.keys(rules).length ? after : before).push(node.toString());
  }
  const sheet: StyleSheet = { rules, preserved: before.join('\n\n'), preservedAfter: after.join('\n\n'), source: root.toString() };
  // Unedited, a sheet serializes back to its own source: skip re-parsing it to find that out.
  styleCache.set(sheet, sheet.source!);
  return sheet;
}

function sameDeclarations(a: Declarations, b: Declarations): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** Patch only edited declarations, preserving duplicate fallbacks, comments and rule order. */
function patchRules(
  root: Root,
  before: Readonly<Record<string, Declarations>>,
  next: Readonly<Record<string, Declarations>>,
  match: (r: Rule) => string | null,
): void {
  // Rules by class, found in one pass (big imported sheets have thousands of classes).
  let byName: Map<string, Rule[]> | null = null;
  const rulesOf = (name: string): Rule[] => {
    if (!byName) {
      byName = new Map();
      root.nodes.forEach((n) => {
        const key = n.type === 'rule' ? match(n) : null;
        if (key !== null) (byName!.get(key) ?? byName!.set(key, []).get(key)!).push(n as Rule);
      });
    }
    return byName.get(name) ?? [];
  };
  for (const name of new Set([...Object.keys(before), ...Object.keys(next)])) {
    // Unchanged rules need no patching (the common case: one edit in a large sheet).
    if (name in before && name in next && sameDeclarations(before[name]!, next[name]!)) continue;
    const rules = [...rulesOf(name)];
    if (!(name in next)) {
      rules.forEach((r) => r.remove());
      continue;
    }
    if (!rules.length) {
      const r = postcss.rule({ selector: name === ':root' ? ':root' : `.${name}` });
      root.append(r);
      rules.push(r);
    }
    for (const prop of new Set([...Object.keys(before[name] ?? {}), ...Object.keys(next[name] ?? {})])) {
      const value = next[name]?.[prop];
      if (value === before[name]?.[prop]) continue;
      const found: Declaration[] = [];
      rules.forEach((r) =>
        r.nodes.forEach((d) => {
          if (d.type === 'decl' && (d.prop.startsWith('--') ? d.prop : d.prop.toLowerCase()) === prop) found.push(d);
        }),
      );
      if (value === undefined) {
        found.forEach((d) => d.remove());
        continue;
      }
      const parsed = parseCss(`a{${prop}:${value}}`).first;
      const declaration = parsed?.type === 'rule' ? parsed.nodes.find((d) => d.type === 'decl') : undefined;
      if (declaration?.type !== 'decl') continue;
      // Keep fallback declarations; update the last winner. Earlier important declarations
      // must lose importance when an explicit edit removes it from the winning declaration.
      const winner = found.at(-1);
      if (winner) {
        if (!declaration.important)
          found.forEach((d) => {
            d.important = false;
          });
        winner.value = declaration.value;
        winner.important = declaration.important;
        delete winner.raws.value;
        delete winner.raws.important;
      } else {
        const rule = rules.at(-1)!;
        const added = postcss.decl({ prop, value: declaration.value, important: declaration.important });
        const previous = rule.nodes.find((d) => d.type === 'decl');
        added.raws.before = previous?.raws.before ?? '\n  ';
        added.raws.between = previous?.raws.between ?? ': ';
        rule.raws.semicolon = true;
        rule.append(added);
      }
    }
  }
}

export function serializeStyleSheet(sheet: StyleSheet): string {
  const cached = styleCache.get(sheet);
  if (cached !== undefined) return cached;
  let result: string;
  if (sheet.source !== undefined) {
    const root = parseCss(sheet.source);
    const base = parseStyleSheet(sheet.source);
    // Legacy callers may still replace the preserved blocks; retain compatibility.
    if (base.preserved !== sheet.preserved || base.preservedAfter !== sheet.preservedAfter) {
      root.nodes.filter((n) => !classOf(n)).forEach((n) => n.remove());
      root.prepend(parseCss(sheet.preserved).nodes);
      root.append(parseCss(sheet.preservedAfter).nodes);
    }
    patchRules(root, base.rules, sheet.rules, (r) => classOf(r));
    result = root.toString();
  } else {
    const parts = [HEADER];
    if (sheet.preserved.trim()) parts.push(sheet.preserved.trim());
    for (const [name, decls] of Object.entries(sheet.rules)) {
      const body = serializeDeclarations(decls);
      parts.push(body ? `.${name} {\n${body}\n}` : `.${name} {}`);
    }
    if (sheet.preservedAfter.trim()) parts.push(sheet.preservedAfter.trim());
    result = parts.join('\n\n') + '\n';
  }
  styleCache.set(sheet, result);
  return result;
}

export function renameStyleClass(sheet: StyleSheet, from: string, to: string): StyleSheet {
  const root = parseCss(serializeStyleSheet(sheet));
  root.walkRules((r) => {
    r.selector = selectorParser((selectors) =>
      selectors.walkClasses((c) => {
        if (c.value === from) c.value = to;
      }),
    ).processSync(r.selector);
  });
  return parseStyleSheet(root.toString());
}

export function parseTokenSheet(css: string): TokenSheet {
  const values: Record<string, string> = Object.create(null),
    declarations: Record<string, string> = Object.create(null);
  const preserved: string[] = [];
  const root = parseCss(css);
  for (const node of root.nodes) {
    if (isTokenRule(node)) collect(node as Rule, declarations);
    else if (node.type !== 'comment' || !node.text.startsWith('Design tokens, written by Plastic.'))
      preserved.push(node.toString());
  }
  for (const [prop, value] of Object.entries(declarations)) values[prop.slice(2)] = value;
  return { values, preserved: preserved.join('\n\n'), source: root.toString() };
}
function isTokenRule(n: Root['nodes'][number]): boolean {
  return (
    n.type === 'rule' &&
    n.selector === ':root' &&
    n.nodes.every((d) => d.type === 'comment' || (d.type === 'decl' && d.prop.startsWith('--')))
  );
}
const tokenCache = new WeakMap<TokenSheet, string>();
export function serializeTokenSheet(sheet: TokenSheet): string {
  const cached = tokenCache.get(sheet);
  if (cached !== undefined) return cached;
  let result: string;
  if (sheet.source !== undefined) {
    const root = parseCss(sheet.source),
      base = parseTokenSheet(sheet.source);
    if (base.preserved !== sheet.preserved) {
      root.nodes.filter((n) => !isTokenRule(n)).forEach((n) => n.remove());
      root.append(parseCss(sheet.preserved).nodes);
    }
    const decls = (values: TokenSheet['values']) =>
      Object.fromEntries(Object.entries(values).map(([n, v]) => [`--${n}`, v]));
    patchRules(root, { ':root': decls(base.values) }, { ':root': decls(sheet.values) }, (r) =>
      isTokenRule(r) ? ':root' : null,
    );
    result = root.toString();
  } else {
    const entries = Object.entries(sheet.values),
      parts = [TOKENS_HEADER];
    parts.push(entries.length ? `:root {\n${entries.map(([n, v]) => `  --${n}: ${v};`).join('\n')}\n}` : ':root {}');
    if (sheet.preserved.trim()) parts.push(sheet.preserved.trim());
    result = parts.join('\n\n') + '\n';
  }
  tokenCache.set(sheet, result);
  return result;
}

export function extractRootTokens(preserved: string): { tokens: Record<string, string>; rest: string } {
  const sheet = parseTokenSheet(preserved);
  return { tokens: { ...sheet.values }, rest: sheet.preserved };
}

/** Move legacy top-level token rules without disturbing intervening selectors. */
export function extractStyleTokens(sheet: StyleSheet): { styles: StyleSheet; tokens: TokenSheet } {
  const root = parseCss(serializeStyleSheet(sheet));
  const tokenRoot = postcss.root();
  root.nodes.slice().forEach((node) => {
    if (isTokenRule(node)) {
      node.remove();
      tokenRoot.append(node);
    }
  });
  return { styles: parseStyleSheet(root.toString()), tokens: parseTokenSheet(tokenRoot.toString()) };
}
