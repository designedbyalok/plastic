/** Curated open Google Fonts; only a chosen family adds a stylesheet request. */
import postcss, { type Root } from 'postcss';
import safeParse from 'postcss-safe-parser';
import { parseStyleSheet, serializeStyleSheet } from './css.ts';
import { setStyleOnNodes } from './ops.ts';
import { INTER_VARIABLE_CSS } from './defaultFont.ts';
import type { DesignDocument, NodeId } from './types.ts';

export const UI_FONTS = [
  'Inter', 'Geist', 'Roboto', 'Open Sans', 'DM Sans', 'Manrope', 'Plus Jakarta Sans',
  'Public Sans', 'Work Sans', 'Source Sans 3', 'IBM Plex Sans', 'Nunito Sans',
  'Outfit', 'Poppins', 'Montserrat', 'Noto Sans', 'Geist Mono', 'JetBrains Mono',
  'Roboto Mono', 'IBM Plex Mono',
] as const;
export const WEB_FONT_OPTIONS = UI_FONTS.map((family) => ({
  label: family,
  value: `${family.includes(' ') ? `"${family}"` : family}, ${family.endsWith('Mono') ? 'monospace' : 'system-ui, sans-serif'}`,
}));
export function googleFontUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${family === 'Inter' ? '100..900' : '400;500;600;700'}&display=swap`;
}
export function selectFont(doc: DesignDocument, ids: readonly NodeId[], value: string): DesignDocument {
  let next = setStyleOnNodes(doc, ids, 'font-family', value || null);
  let resolved = value;
  for (let i = 0; i < 8; i++) {
    const token = /^var\(--([\w-]+)\)$/.exec(resolved);
    if (!token) break;
    resolved = doc.tokens.values[token[1]!] ?? '';
  }
  const family = resolved.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
  if (!UI_FONTS.some((name) => name === family)) return next;
  const url = googleFontUrl(family);
  const root = safeParse(serializeStyleSheet(next.styles)) as Root;
  let present = false;
  root.walkAtRules('import', (rule) => { if (rule.params.includes(url)) present = true; });
  // Respect a project's own bundled/custom face for the same family.
  root.walkAtRules('font-face', (rule) => {
    rule.walkDecls('font-family', (decl) => {
      if (decl.value.replace(/^["']|["']$/g, '') === family) present = true;
    });
  });
  if (present) return next;
  if (family === 'Inter') {
    root.append(safeParse(INTER_VARIABLE_CSS).nodes);
    return { ...next, styles: parseStyleSheet(root.toString()) };
  }
  const rule = postcss.atRule({ name: 'import', params: `url("${url}")` });
  const charset = root.nodes.find((node) => node.type === 'atrule' && node.name === 'charset');
  if (charset) root.insertAfter(charset, rule);
  else root.prepend(rule);
  return { ...next, styles: parseStyleSheet(root.toString()) };
}
