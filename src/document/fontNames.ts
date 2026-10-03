import { type Root } from 'postcss';
import safeParse from 'postcss-safe-parser';
import { parseStyleSheet, serializeStyleSheet } from './css.ts';
import type { DesignDocument } from './types.ts';

/** Captured desktop face names are Inter weights, not different web font families. */
export function normalizeInterFonts(doc: DesignDocument): DesignDocument {
  const source = serializeStyleSheet(doc.styles);
  if (!/Inter\s+(?:Regular|Medium|Variable)/i.test(source + Object.values(doc.tokens.values).join(';'))) return doc;
  const root = safeParse(source) as Root;
  const aliases = new Map<string, number>([['inter regular', 400], ['inter medium', 500], ['inter variable', 400]]);
  const custom = new Set<string>();
  root.walkAtRules('font-face', rule => rule.walkDecls('font-family', decl => { custom.add(decl.value.replace(/^["']|["']$/g, '').toLowerCase()); }));
  let changed = false;
  const tokenWeights = new Map<string, number>();
  const normalize = (value: string): { value: string; weight?: number } => {
    const family = value.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
    if (custom.has(family.toLowerCase())) return { value };
    const weight = aliases.get(family.toLowerCase());
    if (!weight) return { value };
    return { value: value.replace(value.split(',')[0]!, 'Inter'), weight };
  };
  const values = { ...doc.tokens.values };
  for (const [name, value] of Object.entries(values)) {
    const face = normalize(value);
    if (face.weight) { values[name] = face.value; tokenWeights.set(name, face.weight); changed = true; }
  }
  root.walkRules(rule => {
    rule.walkDecls('font-family', decl => {
      const ref = /^var\(--([\w-]+)\)$/.exec(decl.value);
      const face = normalize(decl.value);
      const weight = face.weight ?? (ref ? tokenWeights.get(ref[1]!) : undefined);
      if (!weight) return;
      decl.value = face.value; changed = true;
      const current = rule.nodes.find(node => node.type === 'decl' && node.prop === 'font-weight');
      if (!current) rule.append({ prop: 'font-weight', value: String(weight) });
      else if (current.type === 'decl' && /^(normal|400)$/.test(current.value)) current.value = String(weight);
    });
  });
  const next = changed ? { ...doc, tokens: { ...doc.tokens, values }, styles: parseStyleSheet(root.toString()) } : doc;

  return next;
}
