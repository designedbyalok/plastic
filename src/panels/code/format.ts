/**
 * Format code with Prettier (MIT). Loaded on first use, with only the plugins the language
 * needs, so it costs nothing until someone presses Format.
 */
import type { CodeLanguage } from './CodeEditor.tsx';

export async function formatCode(text: string, language: CodeLanguage): Promise<string> {
  const { format } = await import('prettier/standalone');
  if (language === 'html') {
    const [html, postcss, babel, estree] = await Promise.all([import('prettier/plugins/html'), import('prettier/plugins/postcss'), import('prettier/plugins/babel'), import('prettier/plugins/estree')]);
    // "css" whitespace sensitivity keeps inline text exactly as rendered (no spaces added or lost).
    return format(text, { parser: 'html', plugins: [html, postcss, babel, estree], printWidth: 100, htmlWhitespaceSensitivity: 'css' });
  }
  if (language === 'css') {
    const postcss = await import('prettier/plugins/postcss');
    return format(text, { parser: 'css', plugins: [postcss], printWidth: 100 });
  }
  const [babel, estree] = await Promise.all([import('prettier/plugins/babel'), import('prettier/plugins/estree')]);
  return format(text, { parser: 'json', plugins: [babel, estree] });
}
