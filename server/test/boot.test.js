import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';

let api;
afterAll(() => api?.kill());

async function freePort() {
  const server = createServer().listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  return port;
}

test('TC-NF-10 the API boots in production with only MONGODB_URI and JWT_ACCESS_SECRET and stays up while the database is unreachable', async () => {
  const port = await freePort();
  api = spawn(process.execPath, ['src/local.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    // No bot, KIE or seed variables at all; nothing listens on port 1, so MongoDB is unreachable.
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), MONGODB_URI: 'mongodb://127.0.0.1:1/finance', JWT_ACCESS_SECRET: 'a'.repeat(64) },
  });
  let stderr = '';
  api.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = once(api, 'exit').then(([code]) => `API exited with code ${code}: ${stderr}`);
  const listening = once(api.stdout, 'data').then(String);
  expect(await Promise.race([listening, exited])).toMatch(/API listening/);

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ status: 'error', db: 'down' });
  expect(api.exitCode).toBeNull(); // still running, not crashed
  expect(stderr).toMatch(/health check: database unreachable/);
}, 30_000);
