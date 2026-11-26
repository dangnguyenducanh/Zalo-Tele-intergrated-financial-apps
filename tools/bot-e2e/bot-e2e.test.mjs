// TC-NF-15 (BUG-007): the CLI's help and bad-option paths. TC-NF-20: no credentials file, no sign-up. Run: node --test tools/bot-e2e/
// None of these cases reaches the network: help and option errors are handled before any command runs, and
// the missing-login case points at a port nobody listens on.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('./bot-e2e.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10_000 });

for (const flag of ['--help', '-h']) {
  test(`TC-NF-15 ${flag} prints the usage and exits 0`, () => {
    const { status, stdout, stderr } = run(flag);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /bot-e2e\.mjs setup/);
    assert.match(stdout, /Options: -h\/--help.*--target/);
    assert.equal(stderr, '');
  });
}

test('TC-NF-15 an unknown option exits 1 with a one-line error, the usage and no stack trace', () => {
  const { status, stdout, stderr } = run('list', '--targt', 'staging');
  assert.equal(status, 1);
  assert.equal(stderr.trim().split('\n').length, 1, stderr);
  assert.match(stderr, /--targt/);
  assert.doesNotMatch(stderr, /\n\s+at |ERR_PARSE_ARGS/);
  assert.match(stdout, /bot-e2e\.mjs setup/);
});

test('TC-NF-15 an option without its value exits 1 with a one-line error and no stack trace', () => {
  const { status, stderr } = run('state', '--target');
  assert.equal(status, 1);
  assert.equal(stderr.trim().split('\n').length, 1, stderr);
  assert.doesNotMatch(stderr, /\n\s+at |ERR_PARSE_ARGS/);
});

test('TC-NF-20 a command that needs a login, with no credentials file, makes no network call and prints how to create it', () => {
  const home = mkdtempSync(join(tmpdir(), 'bot-e2e-home-'));
  try {
    const target = 'http://127.0.0.1:9'; // unreachable: any request would fail with a fetch error, not these instructions
    const { status, stdout, stderr } = spawnSync(process.execPath, [cli, 'state', '--target', target], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: home } });
    assert.equal(status, 1);
    assert.match(stderr, /No login for 127\.0\.0\.1:9/);
    assert.match(stderr, /register on the website/i);
    assert.ok(stderr.includes(join(home, '.config', 'bot-e2e', '127.0.0.1:9.json')), stderr);
    assert.match(stderr, /"email".*"password"/);
    assert.match(stderr, /chmod 600/);
    assert.doesNotMatch(stderr + stdout, /\n\s+at |fetch failed|ECONNREFUSED/);
    assert.deepEqual(readdirSync(home), [], 'the tool must not create the credentials file or its folder');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A hand-made credentials file with bad JSON, and a host that cannot be reached: one line, no stack (CLAUDE.md #9).
function withCredsFile(content) {
  const home = mkdtempSync(join(tmpdir(), 'bot-e2e-home-'));
  try {
    mkdirSync(join(home, '.config', 'bot-e2e'), { recursive: true });
    writeFileSync(join(home, '.config', 'bot-e2e', '127.0.0.1:9.json'), content);
    return spawnSync(process.execPath, [cli, 'state', '--target', 'http://127.0.0.1:9'], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, HOME: home } });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('TC-NF-20 a credentials file with bad JSON exits 1 with one line naming the file and its shape, no stack trace', () => {
  const { status, stderr } = withCredsFile('{"email": oops');
  assert.equal(status, 1);
  assert.equal(stderr.trim().split('\n').length, 1, stderr);
  assert.match(stderr, /127\.0\.0\.1:9\.json/);
  assert.match(stderr, /"email".*"password"/);
  assert.doesNotMatch(stderr, /\n\s+at |SyntaxError/);
});

test('TC-NF-20 an unreachable host exits 1 with one line, no stack trace', () => {
  const { status, stderr } = withCredsFile('{"email":"a@b.c","password":"x"}');
  assert.equal(status, 1);
  assert.equal(stderr.trim().split('\n').length, 1, stderr);
  assert.match(stderr, /127\.0\.0\.1:9/);
  assert.doesNotMatch(stderr, /\n\s+at |TypeError/);
});
