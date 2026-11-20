import { defineConfig, devices } from '@playwright/test';

// Ports come from tools/wt-env.sh (API 4100+10n, Vite 5300+10n); the defaults match slot 0.
const apiPort = process.env.PORT ?? '4100';
const webPort = process.env.VITE_PORT ?? '5300';

export default defineConfig({
  testDir: 'client/e2e',
  outputDir: 'client/test-results', // videos and traces (docs/07 §7.4)
  reporter: [['list'], ['junit', { outputFile: 'test-results/e2e.xml' }]],
  use: {
    baseURL: `http://localhost:${webPort}`,
    video: 'on',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // API against an in-memory MongoDB (or MONGODB_URI/MONGODB_DB when set in the environment).
      command: 'node server/test/helpers/e2e-server.js',
      url: `http://localhost:${apiPort}/api/health`,
      env: { NODE_ENV: 'test', PORT: apiPort },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w client',
      url: `http://localhost:${webPort}`,
      env: { PORT: apiPort, VITE_PORT: webPort },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
