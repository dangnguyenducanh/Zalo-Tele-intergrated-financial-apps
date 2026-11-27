import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    env: { NODE_ENV: 'test' },
    setupFiles: ['./test/helpers/no-gmail.js', './test/helpers/mail-mock.js'], // before every test file: no real Gmail setting may reach a test, and no test sends mail
    hookTimeout: 120_000, // the first run downloads the MongoDB binary for mongodb-memory-server
    reporters: ['default', 'junit'],
    outputFile: { junit: '../test-results/server-vitest.xml' },
  },
});
