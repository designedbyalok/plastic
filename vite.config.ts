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

export default defineConfig({
  plugins: [openPencilWorkerFix(), react(), process.env.VITEST ? null : plasticWorkspace()],
  worker: { format: 'es' },
  server: {
    // Design files are served through the workspace plugin, not as app modules.
    watch: { ignored: ['**/workspace/**'] },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
