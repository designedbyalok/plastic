/**
 * Is a font family installed (or loaded as a web font) in this browser? Measures sample text in
 * the family with each generic fallback: if every width matches the bare fallback, the browser
 * fell back, so the family isn't available. No permission prompt (unlike the Local Font Access
 * API), and it covers web fonts loaded with @font-face as well.
 */
const SAMPLE = 'mmmmmmmmmmlli1WQ@#&Ñ';
const FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const;
const cache = new Map<string, boolean>();
let context: CanvasRenderingContext2D | null | undefined;

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont']);

export function isFontAvailable(family: string): boolean {
  const name = family.trim().replace(/^["']|["']$/g, '');
  if (!name || GENERIC.has(name.toLowerCase())) return true;
  const known = cache.get(name);
  if (known !== undefined) return known;
  context ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!context) return true;
  const quoted = `"${name.replace(/"/g, '')}"`;
  const available = FALLBACKS.some((fallback) => {
    context!.font = `72px ${fallback}`;
    const base = context!.measureText(SAMPLE).width;
    context!.font = `72px ${quoted}, ${fallback}`;
    return context!.measureText(SAMPLE).width !== base;
  });
  cache.set(name, available);
  return available;
}

/** The first family of a font-family value ("Inter", sans-serif → Inter). */
export function primaryFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** Families in a font-family value, or a var() resolved through `tokens`, that aren't available. */
export function missingFamily(value: string, tokens: Readonly<Record<string, string>>): string | null {
  let v = value.trim();
  for (let i = 0; i < 4; i++) {
    const ref = /^var\(--([\w-]+)\)$/.exec(v);
    if (!ref) break;
    v = tokens[ref[1]!] ?? '';
  }
  const family = primaryFamily(v);
  return family && !isFontAvailable(family) ? family : null;
}
