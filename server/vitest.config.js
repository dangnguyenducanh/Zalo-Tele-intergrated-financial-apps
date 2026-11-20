import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    env: { NODE_ENV: 'test' },
    hookTimeout: 120_000, // the first run downloads the MongoDB binary for mongodb-memory-server
    reporters: ['default', 'junit'],
    outputFile: { junit: '../test-results/server-vitest.xml' },
  },
});
