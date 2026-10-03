import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { plasticWorkspace } from './server/workspace.ts';

/**
 * @open-pencil/* 0.15.1 ships built files that start their Web Workers from "./name.ts", but the
 * packages contain name.js. Point those URLs at the files that exist.
 */
function openPencilWorkerFix(): Plugin {
  return {
    name: 'open-pencil-worker-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/@open-pencil\/[^/]+\/dist\//.test(id) || !code.includes('.ts", import.meta.url')) return null;
      return code.replace(/new URL\("(\.{1,2}\/[^"]+)\.ts", import\.meta\.url\)/g, 'new URL("$1.js", import.meta.url)');
    },
  };
}

/**
 * Every production build gets an id, compiled into the app (__PLASTIC_BUILD__) and written to
 * /version.json. Open tabs compare the two to offer "Update available" after a deploy; the file
 * is a static asset, so checking it never runs the Worker or costs a request.
 */
function buildVersion(): Plugin {
  const id = Date.now().toString(36);
  return {
    name: 'plastic-build-version',
    config: (_, { command }) => ({ define: { __PLASTIC_BUILD__: JSON.stringify(command === 'build' && !process.env.VITEST ? id : 'dev') } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id }) });
    },
  };
}

export default defineConfig({
  plugins: [openPencilWorkerFix(), react(), buildVersion(), process.env.VITEST ? null : plasticWorkspace()],
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // UI primitives (menus, selects, popovers and what they're built on) change far less
            // often than the app: one shared chunk that stays cached across deploys.
            {
              name: 'ui-vendor',
              test: /node_modules[\\/](@radix-ui|@floating-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|get-nonce|tslib)[\\/]/,
            },
          ],
        },
      },
    },
  },
  // Path operations use Paper.js for geometry only; its core build leaves out PaperScript.
  resolve: { alias: [{ find: /^paper$/, replacement: 'paper/dist/paper-core.js' }] },
  server: {
    // Design files are served through the workspace plugin, not as app modules.
    watch: { ignored: ['**/workspace/**'] },
  },
  test: {
    environment: 'node',
    // Through Vite (and its alias), so paperjs-offset and our code share one Paper.js.
    server: { deps: { inline: ['paperjs-offset'] } },
    include: ['tests/**/*.test.ts'],
  },
});
