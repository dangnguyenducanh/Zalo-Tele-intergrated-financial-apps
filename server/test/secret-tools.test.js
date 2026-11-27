import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

// tools/set-secret.sh and tools/vercel-env-push.sh run here in a temporary git repo with a made-up server/.env and a
// fake `npx` first on PATH that records each call and sends nothing: no network, no Vercel, never the real file.
const realTools = resolve(dirname(fileURLToPath(import.meta.url)), '../../tools');

const ENV_FILE = [
  // Built at run time: the TC-NF-05 scan of tracked files must not read this made-up URI as a leaked database password.
  `MONGODB_URI=${['mongodb+srv://', 'made-up:', 'made-up-db-pass', '@cluster.invalid/finance'].join('')}`,
  'TELEGRAM_BOT_TOKEN=made-up-telegram-token',
  'GMAIL_USER=made-up-sender@example.com',
  'GMAIL_USERNAME=made-up-neighbour', // starts like GMAIL_USER: a prefix must not match
  'ZALO_BOT_TOKEN=made-up-zalo-token',
  'VERCEL_ORG_ID=team_made_up',
  'VERCEL_PROJECT_ID_STAGING=prj_made_up_staging',
  'VERCEL_PROJECT_ID_PROD=prj_made_up_prod',
  '',
].join('\n');
const VALUES = ['made-up-db-pass', 'made-up-telegram-token', 'made-up-sender@example.com', 'made-up-neighbour', 'made-up-zalo-token'];
const STAGING = 'prj_made_up_staging';
const PROD = 'prj_made_up_prod';

// The fake npx writes one tab-separated line per call: project, org, arguments, what came in on stdin.
const FAKE_NPX = `#!/usr/bin/env bash
in=""; [ -t 0 ] || in="$(cat)"
printf '%s\\t%s\\t%s\\t%s\\n' "\${VERCEL_PROJECT_ID:-}" "\${VERCEL_ORG_ID:-}" "$*" "$in" >> "$FAKE_NPX_LOG"
# args: -y <cli> env <add|rm> <KEY> ...; FAKE_NPX_FAIL is a space-separated list of project:KEY that fail
case " \${FAKE_NPX_FAIL:-} " in *" \${VERCEL_PROJECT_ID:-}:$5 "*) exit 1 ;; esac
exit 0
`;

let repo;
let log;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'secret-tools-')));
  log = join(repo, 'npx.log');
  mkdirSync(join(repo, 'tools'));
  mkdirSync(join(repo, 'server'));
  mkdirSync(join(repo, 'bin'));
  for (const script of ['set-secret.sh', 'vercel-env-push.sh']) copyFileSync(join(realTools, script), join(repo, 'tools', script));
  writeFileSync(join(repo, 'tools', 'deploy.sh'), 'VERCEL_CLI="vercel@1.2.3"\n'); // the push script reads the pinned CLI from here
  writeFileSync(join(repo, 'server', '.env'), ENV_FILE, { mode: 0o600 });
  writeFileSync(join(repo, 'bin', 'npx'), FAKE_NPX);
  chmodSync(join(repo, 'bin', 'npx'), 0o755);
  writeFileSync(log, '');
  const top = spawnSync('git', ['init', '-q'], { cwd: repo });
  expect(top.status).toBe(0);
  // The fake must be the npx bash finds (same environment as run()): on a /tmp mounted noexec bash would skip it and run the real npx.
  const found = spawnSync('bash', ['-c', 'command -v npx'], { env: { PATH: `${join(repo, 'bin')}:${process.env.PATH}`, HOME: repo }, encoding: 'utf8' });
  expect(found.stdout.trim()).toBe(join(repo, 'bin', 'npx'));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function run(script, args, { fail = '', input = '' } = {}) {
  const result = spawnSync('bash', [join(repo, 'tools', script), ...args], {
    cwd: repo,
    input,
    encoding: 'utf8',
    timeout: 20_000,
    env: { PATH: `${join(repo, 'bin')}:${process.env.PATH}`, HOME: repo, FAKE_NPX_LOG: log, FAKE_NPX_FAIL: fail },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [project, org, args, stdin] = line.split('\t');
    return { project, org, args, stdin };
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout, stderr: result.stderr, calls };
}

const envFile = () => readFileSync(join(repo, 'server', '.env'), 'utf8');
const rm = (key) => `-y vercel@1.2.3 env rm ${key} --environment production --confirm-name ${key}`;
const withoutLines = (...prefixes) => ENV_FILE.split('\n').filter((line) => !prefixes.some((p) => line.startsWith(`${p}=`))).join('\n');

describe('--remove', () => {
  test('TC-NF-22 set-secret.sh --remove deletes only the named lines, removes the keys from both Vercel projects (also one that is not in the file), prints no value', () => {
    const r = run('set-secret.sh', ['--remove', 'GMAIL_USER', 'GMAIL_APP_PASSWORD']);

    expect(r.status, r.out).toBe(0);
    expect(envFile()).toBe(withoutLines('GMAIL_USER')); // GMAIL_USERNAME and every other line stay, in order
    expect(statSync(join(repo, 'server', '.env')).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(repo, 'server'))).toEqual(['.env']); // no temp file left behind
    // GMAIL_APP_PASSWORD was never in the file (docs/06 §6.14: it lives only in the dashboard) and is still removed.
    expect(r.calls.map(({ project, org, args, stdin }) => ({ project, org, args, stdin }))).toEqual(
      [STAGING, PROD].flatMap((project) => ['GMAIL_USER', 'GMAIL_APP_PASSWORD'].map((key) => ({ project, org: 'team_made_up', args: rm(key), stdin: '' }))),
    );
    for (const value of VALUES) expect(r.out).not.toContain(value);
    expect(r.out).toMatch(/GMAIL_USER/);
    expect(r.out).toMatch(/GMAIL_APP_PASSWORD/);
    expect(r.out).toMatch(/[Rr]edeploy/);
  });

  test('TC-NF-22 a key that is in neither the file nor Vercel is still sent to both projects, and the file is untouched', () => {
    const r = run('set-secret.sh', ['--remove', 'GMAIL_APP_PASSWORD']);

    expect(r.status, r.out).toBe(0);
    expect(envFile()).toBe(ENV_FILE);
    expect(r.calls.map((c) => [c.project, c.args])).toEqual([[STAGING, rm('GMAIL_APP_PASSWORD')], [PROD, rm('GMAIL_APP_PASSWORD')]]);
  });

  test('TC-NF-22 a removal that fails is named by key, with a non-zero exit and the retry command for that project only', () => {
    const r = run('set-secret.sh', ['--remove', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'], { fail: `${STAGING}:GMAIL_USER` });

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAILED GMAIL_USER/);
    expect(r.stderr).not.toMatch(/FAILED GMAIL_APP_PASSWORD/);
    expect(r.stderr).toContain('tools/vercel-env-push.sh staging --remove GMAIL_USER');
    expect(r.out).not.toContain('production --remove'); // production worked
    expect(r.out).not.toMatch(/^Removed: /m); // the closing line of a clean run: it must not claim success
    expect(envFile()).toBe(withoutLines('GMAIL_USER')); // the local line is gone either way
    expect(r.calls).toHaveLength(4); // the other keys and the other project were still tried
    for (const value of VALUES) expect(r.out).not.toContain(value);
  });

  test('TC-NF-22 a project ID missing from server/.env stops that project only, and the failure says which command to retry', () => {
    writeFileSync(join(repo, 'server', '.env'), ENV_FILE.replace(/^VERCEL_PROJECT_ID_STAGING=.*\n/m, ''));
    const r = run('set-secret.sh', ['--remove', 'GMAIL_USER']);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('VERCEL_ORG_ID or the staging project ID is missing');
    expect(r.stderr).toContain('Retry: tools/vercel-env-push.sh staging --remove GMAIL_USER'); // the line "Run the Retry command(s) above" points at
    expect(r.calls.map((c) => [c.project, c.args])).toEqual([[PROD, rm('GMAIL_USER')]]); // production was still done
  });

  test('TC-NF-22 vercel-env-push.sh <target> --remove removes the keys from that project only', () => {
    const r = run('vercel-env-push.sh', ['production', '--remove', 'GMAIL_USER', 'GMAIL_APP_PASSWORD']);

    expect(r.status, r.out).toBe(0);
    expect(r.calls.map((c) => [c.project, c.args])).toEqual([[PROD, rm('GMAIL_USER')], [PROD, rm('GMAIL_APP_PASSWORD')]]);
    expect(envFile()).toBe(ENV_FILE); // the file is set-secret.sh's to change
    expect(r.out).not.toMatch(/made-up/);
  });

  test('TC-NF-22 a bad key name, a misplaced or misspelled --remove, no key, or an unknown target stops before anything is deleted or sent', () => {
    for (const [script, args] of [
      ['set-secret.sh', ['--remove', 'GMAIL_USER', 'gmail_user']],
      ['set-secret.sh', ['--remove', 'GMAIL_USER;ls']],
      ['set-secret.sh', ['--remove']],
      ['vercel-env-push.sh', ['staging', '--remove']],
      ['vercel-env-push.sh', ['staging', '--remove', 'bad key']],
      // A misplaced or misspelled --remove must not be pushed as a key (it would re-push the very value being removed).
      ['vercel-env-push.sh', ['staging', 'GMAIL_USER', '--remove']],
      ['vercel-env-push.sh', ['staging', '--remve', 'GMAIL_USER']],
      ['vercel-env-push.sh', ['staging', 'GMAIL_USER', 'bad key']],
      ['vercel-env-push.sh', ['nowhere', '--remove', 'GMAIL_USER']],
    ]) {
      const r = run(script, args);
      expect(r.status, `${script} ${args.join(' ')}\n${r.out}`).toBe(2);
      expect(envFile()).toBe(ENV_FILE);
      expect(r.calls).toEqual([]);
    }
  });

  test('TC-NF-22 both tools answer --help with their usage, including --remove, and change nothing', () => {
    for (const script of ['set-secret.sh', 'vercel-env-push.sh']) {
      const r = run(script, ['--help']);
      expect(r.status, script).toBe(0);
      expect(r.stdout, script).toMatch(/[Uu]sage/);
      expect(r.stdout, script).toContain('--remove');
      expect(envFile()).toBe(ENV_FILE);
      expect(r.calls).toEqual([]);
    }
  });
});

describe('the normal push', () => {
  test('TC-NF-23 vercel-env-push.sh with no key still pushes the GMAIL_* keys that are in the file, value on stdin and never printed', () => {
    const file = `${ENV_FILE}GMAIL_APP_PASSWORD=made-up-app-password\n`;
    writeFileSync(join(repo, 'server', '.env'), file);

    const r = run('vercel-env-push.sh', ['production']);

    expect(r.status, r.out).toBe(0);
    const added = Object.fromEntries(r.calls.filter((c) => c.args.startsWith('-y vercel@1.2.3 env add ')).map((c) => [c.args.split(' ')[4], c]));
    expect(added.GMAIL_USER).toMatchObject({ project: PROD, args: '-y vercel@1.2.3 env add GMAIL_USER production --force --yes', stdin: 'made-up-sender@example.com' });
    expect(added.GMAIL_APP_PASSWORD).toMatchObject({ project: PROD, stdin: 'made-up-app-password' });
    expect(added.GMAIL_USERNAME).toMatchObject({ stdin: 'made-up-neighbour' });
    expect(r.calls.some((c) => / env rm /.test(c.args))).toBe(false);
    for (const value of [...VALUES, 'made-up-app-password']) expect(r.out).not.toContain(value);
  });

  test('TC-NF-23 set-secret.sh GMAIL_USER (no --remove) saves the pasted value and pushes it to both projects as before', () => {
    const r = run('set-secret.sh', ['GMAIL_USER'], { input: 'new-sender@example.com\n' });

    expect(r.status, r.out).toBe(0);
    expect(envFile()).toBe(ENV_FILE.replace('GMAIL_USER=made-up-sender@example.com', 'GMAIL_USER=new-sender@example.com'));
    expect(r.calls.map((c) => [c.project, c.args, c.stdin])).toEqual([
      [STAGING, '-y vercel@1.2.3 env add GMAIL_USER production --force --yes', 'new-sender@example.com'],
      [PROD, '-y vercel@1.2.3 env add GMAIL_USER production --force --yes', 'new-sender@example.com'],
    ]);
    expect(r.out).not.toContain('new-sender@example.com');
  });
});
