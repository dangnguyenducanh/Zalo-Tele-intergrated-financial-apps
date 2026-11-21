// TC-NF-15 (BUG-007): the CLI's help and bad-option paths. Run: node --test tools/bot-e2e/
// None of these cases reaches the network: help and option errors are handled before any command runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
