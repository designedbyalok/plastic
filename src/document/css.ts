/**
 * styles.css <-> StyleSheet.
 *
 * A deliberately small parser: single-class rules become editable declarations, everything
 * else is preserved verbatim. Comments are not preserved (documented limitation).
 */
import type { Declarations, StyleSheet, TokenSheet } from './types.ts';

export const EMPTY_SHEET: StyleSheet = { rules: {}, preserved: '', preservedAfter: '' };

const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
const CLASS_SELECTOR = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)$/;

const HEADER =
  '/* Written by Plastic. Edit freely: class rules round-trip through the visual editor,\n' +
  '   other rules are preserved as-is. */';

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
  if (!slug) return 'el';
  return /^[a-z_]/.test(slug) ? slug : `el-${slug}`;
}

function skipString(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = skipString(src, i) - 1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

/** Split on `separator` at top level: outside strings and parentheses (e.g. `url(data:…;…)`). */
function splitTopLevel(src: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = skipString(src, i) - 1;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === separator && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
}

export function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of splitTopLevel(stripComments(body), ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith('--') ? prop : prop.toLowerCase()] = value;
  }
  return out;
}

export function serializeDeclarations(decls: Declarations, indent = '  '): string {
  return Object.entries(decls)
    .map(([prop, value]) => `${indent}${prop}: ${value};`)
    .join('\n');
}

/** Walk top-level statements and blocks of a stylesheet (comments stripped). */
function scanTopLevel(css: string, onBlock: (prelude: string, body: string, raw: string) => void, onStatement: (raw: string) => void): void {
  const src = stripComments(css);
  let start = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = skipString(src, i);
      continue;
    }
    if (ch === ';') {
      const statement = src.slice(start, i + 1).trim();
      if (statement !== ';') onStatement(statement);
      start = ++i;
      continue;
    }
    if (ch === '{') {
      const close = matchBrace(src, i);
      onBlock(src.slice(start, i).trim(), src.slice(i + 1, close), src.slice(start, close + 1).trim());
      start = i = close + 1;
      continue;
    }
    i++;
  }
}

export function parseStyleSheet(css: string): StyleSheet {
  const rules: Record<string, Record<string, string>> = {};
  const before: string[] = [];
  const after: string[] = [];
  const keep = (text: string) => (Object.keys(rules).length ? after : before).push(text);
  scanTopLevel(
    css,
    (prelude, body, raw) => {
      const match = CLASS_SELECTOR.exec(prelude);
      if (match?.[1] && !body.includes('{')) rules[match[1]] = { ...rules[match[1]], ...parseDeclarations(body) };
      else keep(raw);
    },
    keep,
  );
  return { rules, preserved: before.join('\n\n'), preservedAfter: after.join('\n\n') };
}

const TOKENS_HEADER =
  '/* Design tokens, written by Plastic. Use them in styles.css as var(--name).\n' +
  '   Names follow the Tailwind v4 theme namespaces: color-, spacing-, radius-, font-, text-, … */';

/**
 * tokens.css: custom properties on the first plain `:root` rule are tokens; everything else
 * (dark-mode overrides, @font-face…) is preserved verbatim after them.
 */
export function parseTokenSheet(css: string): TokenSheet {
  const values: Record<string, string> = {};
  const preserved: string[] = [];
  scanTopLevel(
    css,
    (prelude, body, raw) => {
      const decls = prelude === ':root' && !body.includes('{') ? parseDeclarations(body) : null;
      if (decls && Object.keys(decls).every((p) => p.startsWith('--'))) {
        for (const [prop, value] of Object.entries(decls)) values[prop.slice(2)] = value;
      } else {
        preserved.push(raw);
      }
    },
    (raw) => preserved.push(raw),
  );
  return { values, preserved: preserved.join('\n\n') };
}

export function serializeTokenSheet(sheet: TokenSheet): string {
  const entries = Object.entries(sheet.values);
  const parts = [TOKENS_HEADER];
  parts.push(entries.length ? `:root {\n${entries.map(([n, v]) => `  --${n}: ${v};`).join('\n')}\n}` : ':root {}');
  if (sheet.preserved.trim()) parts.push(sheet.preserved.trim());
  return parts.join('\n\n') + '\n';
}

/**
 * Projects from before tokens.css kept `:root { --x: … }` in styles.css. Move those variables
 * into tokens, leaving the rest of the preserved CSS untouched.
 */
export function extractRootTokens(preserved: string): { tokens: Record<string, string>; rest: string } {
  const sheet = parseTokenSheet(preserved);
  return { tokens: { ...sheet.values }, rest: sheet.preserved };
}

export function serializeStyleSheet(sheet: StyleSheet): string {
  const parts = [HEADER];
  if (sheet.preserved.trim()) parts.push(sheet.preserved.trim());
  for (const [name, decls] of Object.entries(sheet.rules)) {
    const body = serializeDeclarations(decls);
    parts.push(body ? `.${name} {\n${body}\n}` : `.${name} {}`);
  }
  if (sheet.preservedAfter.trim()) parts.push(sheet.preservedAfter.trim());
  return parts.join('\n\n') + '\n';
}
