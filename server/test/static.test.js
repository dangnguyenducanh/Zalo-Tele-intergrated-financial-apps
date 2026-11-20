import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

// Repository-level checks, run with the other tests so their results carry a case ID in the JUnit report.
const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..', '..');
const git = async (...args) => (await run('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })).stdout;
const trackedFiles = async () => (await git('ls-files', '-z')).split('\0').filter(Boolean);

test('TC-NF-01 the client type check and ESLint pass with 0 errors', async () => {
  // Both reject (and fail this test) on a non-zero exit code, with the tool output in the error.
  await run('npm', ['run', 'typecheck'], { cwd: ROOT });
  await run('npm', ['run', 'lint'], { cwd: ROOT });
}, 120_000);

// .env, .env.local, server/.env, … but not .env.example
const isEnvFile = (path) => /^\.env(\..+)?$/.test(basename(path)) && basename(path) !== '.env.example';

test('TC-NF-05 no env file is tracked or was ever committed; only .env.example', async () => {
  const tracked = await trackedFiles();
  expect(tracked.filter(isEnvFile)).toEqual([]);
  expect(tracked).toContain('.env.example');

  // Every path ever added in the history git has here (CI checks out one commit, a full clone sees all).
  const everAdded = (await git('log', '--all', '--diff-filter=A', '--name-only', '--format=')).split('\n');
  expect([...new Set(everAdded.filter(isEnvFile))]).toEqual([]);
});

test('TC-NF-05 tracked files hold no credentials: no bot token, database password, private key or local secret', async () => {
  const patterns = {
    telegramBotToken: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
    mongoUriWithPassword: /mongodb(\+srv)?:\/\/[^\s:@/<>]+:(?!PASTE_)[^\s@<>]+@/, // <db_password> and PASTE_ placeholders are fine
    privateKey: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  };
  // The real values in server/.env, when this machine has one (CI does not). They are compared, never printed.
  const localSecrets = existsSync(join(ROOT, 'server/.env'))
    ? readFileSync(join(ROOT, 'server/.env'), 'utf8')
        .split('\n')
        .map((line) => /^([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY|URI)[A-Z0-9_]*)=(.+)$/.exec(line.trim()))
        .filter((m) => m !== null)
        .map((m) => ({ name: m[1], value: m[3].replace(/^(['"])(.*)\1$/, '$2') }))
        .filter(({ value }) => value.length >= 12 && !value.startsWith('PASTE_')) // skip short settings and placeholders
    : [];

  const leaks = [];
  for (const path of await trackedFiles()) {
    if (!existsSync(join(ROOT, path))) continue; // deleted in the working tree
    const text = readFileSync(join(ROOT, path), 'utf8');
    for (const [name, pattern] of Object.entries(patterns)) if (pattern.test(text)) leaks.push(`${path}: ${name}`);
    for (const { name, value } of localSecrets) if (text.includes(value)) leaks.push(`${path}: value of ${name}`);
  }
  expect(leaks).toEqual([]);
});
