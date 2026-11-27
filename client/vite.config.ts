import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Ports come from tools/wt-env.sh so parallel worktrees never collide (API 4100+10n, Vite 5300+10n).
const apiPort = process.env.PORT ?? '4100';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: Number(process.env.VITE_PORT ?? 5300),
    strictPort: true,
    // Same origin as production: the browser only talks to Vite, which forwards /api to Express.
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30_000, // BUG-043: 5 s (default) is too short for a whole-app test on a loaded machine (many agents in parallel); a passing test is not slower
    setupFiles: ['./src/setupTests.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: '../test-results/client-vitest.xml' },
  },
});
