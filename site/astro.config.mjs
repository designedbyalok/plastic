// The public site: landing (/), changelog and download pages. Built into dist/site/ after the app;
// the Worker serves it on the same domain (see worker/site.ts), so built asset URLs live under /site.
import { defineConfig } from 'astro/config';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://useplastic.app',
  outDir: '../dist/site',
  trailingSlash: 'never',
  build: { format: 'file', assetsPrefix: '/site', inlineStylesheets: 'auto' },
  // Lucide for interface icons, Simple Icons for brand logos; inlined as SVG at build time.
  // Listed explicitly: the icon sets live in the repo root's node_modules, and a typo fails the build.
  integrations: [
    icon({
      iconDir: 'site/src/icons',
      include: {
        lucide: ["arrow-right", "arrow-up-right", "bell", "blend", "bot", "braces", "check", "chevron-down", "chevron-right", "circle-check", "circle-plus", "clock", "code-xml", "component", "file", "file-code-2", "folder-git-2", "frame", "gauge", "globe", "hand", "hash", "heading", "image", "layout-grid", "lock", "magnet", "mail-check", "menu", "messages-square", "minus", "monitor-smartphone", "mouse-pointer-2", "mouse-pointer-click", "palette", "pen-tool", "pencil", "plug", "plus", "rectangle-horizontal", "refresh-cw", "rocket", "rows-3", "scan-eye", "shield-check", "sliders-horizontal", "sparkles", "square", "square-dashed-mouse-pointer", "squares-unite", "tag", "terminal", "text-cursor-input", "type", "wand-sparkles", "wifi-off", "wrench", "zap"],
        'simple-icons': ["apple", "claude", "cloudflare", "css", "cursor", "figma", "firefoxbrowser", "git", "githubcopilot", "googlechrome", "html5", "linux", "openai", "safari", "windows"],
      },
    }),
  ],
  devToolbar: { enabled: false },
});
