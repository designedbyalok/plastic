import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { plasticWorkspace } from './server/workspace.ts';

export default defineConfig({
  plugins: [react(), process.env.VITEST ? null : plasticWorkspace()],
  server: {
    // Design files are served through the workspace plugin, not as app modules.
    watch: { ignored: ['**/workspace/**'] },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
