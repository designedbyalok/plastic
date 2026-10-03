/**
 * Design tokens are CSS custom properties. Their kind comes from the name prefix (the Tailwind
 * v4 theme namespaces, which Paper also uses), so tokens.css stays plain, readable CSS.
 */
import { parseStyleSheet, parseTokenSheet, serializeStyleSheet, serializeTokenSheet } from './css.ts';
import type { DesignDocument } from './types.ts';

export type TokenKind = 'color' | 'spacing' | 'radius' | 'font' | 'text' | 'font-weight' | 'leading' | 'tracking' | 'opacity' | 'shadow' | 'other';

export interface TokenGroup {
  readonly kind: TokenKind;
  readonly label: string;
  /** Name prefix, e.g. "color-". */
  readonly prefix: string;
  /** Value for a newly added token. */
  readonly sample: string;
}

/** Order matters: "font-weight-" must be checked before "font-". */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
  { kind: 'color', label: 'Colors', prefix: 'color-', sample: '#4f46e5' },
  { kind: 'spacing', label: 'Spacing', prefix: 'spacing-', sample: '8px' },
  { kind: 'radius', label: 'Radius', prefix: 'radius-', sample: '8px' },
  { kind: 'font-weight', label: 'Font Weights', prefix: 'font-weight-', sample: '600' },
  { kind: 'font', label: 'Fonts', prefix: 'font-', sample: 'Inter, system-ui, sans-serif' },
  { kind: 'text', label: 'Font Sizes', prefix: 'text-', sample: '16px' },
  { kind: 'leading', label: 'Line Heights', prefix: 'leading-', sample: '1.5' },
  { kind: 'tracking', label: 'Letter Spacing', prefix: 'tracking-', sample: '-0.01em' },
  { kind: 'opacity', label: 'Opacity', prefix: 'opacity-', sample: '60%' },
  { kind: 'shadow', label: 'Shadows', prefix: 'shadow-', sample: '0 1px 3px rgb(0 0 0 / 0.12)' },
];

export const OTHER_GROUP: TokenGroup = { kind: 'other', label: 'Other', prefix: '', sample: '0' };

export function tokenKind(name: string): TokenKind {
  return TOKEN_GROUPS.find((g) => name.startsWith(g.prefix))?.kind ?? 'other';
}

export function groupFor(kind: TokenKind): TokenGroup {
  return TOKEN_GROUPS.find((g) => g.kind === kind) ?? OTHER_GROUP;
}

/** Which kind of token fits a CSS property (null: no tokens offered). */
export function tokenKindForProperty(prop: string): TokenKind | null {
  if (/(^|-)color$|^background(-color)?$|^fill$|^stroke$/.test(prop)) return 'color';
  if (prop === 'border-radius' || prop.endsWith('-radius')) return 'radius';
  if (/^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)|^(min-|max-)?(width|height)$/.test(prop)) return 'spacing';
  if (prop === 'font-family') return 'font';
  if (prop === 'font-size') return 'text';
  if (prop === 'font-weight') return 'font-weight';
  if (prop === 'line-height') return 'leading';
  if (prop === 'letter-spacing') return 'tracking';
  if (prop === 'opacity') return 'opacity';
  if (prop === 'box-shadow' || prop === 'text-shadow') return 'shadow';
  return null;
}

export const TOKEN_NAME = /^[a-zA-Z_][\w-]*$/;

/** `var(--color-primary)` → "color-primary". */
export function tokenReference(value: string): string | null {
  return /^var\(--([\w-]+)\)$/.exec(value.trim())?.[1] ?? null;
}

export function tokenVar(name: string): string {
  return `var(--${name})`;
}

export function uniqueTokenName(doc: DesignDocument, base: string): string {
  if (!(base in doc.tokens.values)) return base;
  let n = 2;
  while (`${base}-${n}` in doc.tokens.values) n++;
  return `${base}-${n}`;
}

function withValues(doc: DesignDocument, values: Record<string, string>): DesignDocument {
  return { ...doc, tokens: { ...doc.tokens, values } };
}

export function setToken(doc: DesignDocument, name: string, value: string): DesignDocument {
  if (!TOKEN_NAME.test(name) || doc.tokens.values[name] === value) return doc;
  return withValues(doc, { ...doc.tokens.values, [name]: value });
}

export function removeToken(doc: DesignDocument, name: string): DesignDocument {
  if (!(name in doc.tokens.values)) return doc;
  const values = { ...doc.tokens.values };
  delete values[name];
  return withValues(doc, values);
}

function replaceVar(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`var\\(--${from.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g'), `var(--${to}`);
}

/**
 * Rename a token and every `var(--…)` that refers to it, in class rules and in other tokens
 * (aliases), keeping the token's position.
 */
export function renameToken(doc: DesignDocument, from: string, to: string): DesignDocument {
  if (from === to || !TOKEN_NAME.test(to) || to in doc.tokens.values || !(from in doc.tokens.values)) return doc;
  const tokenRoot = parseTokenSheet(serializeTokenSheet(doc.tokens));
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokenRoot.values)) values[name === from ? to : name] = replaceVar(value, from, to);
  return {
    ...doc,
    tokens: { ...parseTokenSheet(replaceVar(serializeTokenSheet(tokenRoot), from, to)), values },
    styles: parseStyleSheet(replaceVar(serializeStyleSheet(doc.styles), from, to)),
  };
}

/** How many class declarations use a token. */
export function tokenUsage(doc: DesignDocument, name: string): number {
  const ref = new RegExp(`var\\(--${name.replace(/[-]/g, '\\-')}(?![\\w-])`);
  let count = 0;
  for (const decls of Object.values(doc.styles.rules)) for (const value of Object.values(decls)) if (ref.test(value)) count++;
  return count;
}
