#!/usr/bin/env node
// Real-chat bot e2e checker (docs/testing/bot-e2e.md). Someone types the steps of scenarios.json into the real
// Telegram and Zalo chats with the deployed bots (Claude through Claude in Chrome on Telegram Web and Zalo Web,
// or a person on a phone); after each step this tool checks the bot's replies, as read off the screen, and the
// server state of a dedicated e2e web user through the public API. No dependencies, Node 20+.
//
//   node tools/bot-e2e/bot-e2e.mjs setup              create the e2e user once, then empty it: no transactions, no chat links
//   node tools/bot-e2e/bot-e2e.mjs code               a fresh link code (and the Telegram deep link) for TG-01 / ZL-01
//   node tools/bot-e2e/bot-e2e.mjs list               every step: what to do, the expected replies and state
//   node tools/bot-e2e/bot-e2e.mjs step <ID> --reply "<text>" [--reply "<text>"]… [--button "<label>"]…
//                                                     check one step; exit 1 when a reply, a button or the state is wrong
//                                                     (receipt steps also take --photo <file>: its true total is expected)
//   node tools/bot-e2e/bot-e2e.mjs state              the e2e user's server state as JSON
//   node tools/bot-e2e/bot-e2e.mjs reset              delete the e2e user's transactions and unlink its chats
// Options: --target prod|staging|<https URL> (default prod), --out <dir> for results.jsonl
//          (default charter-runs/<VN date>/bot-e2e/ in the repo, which git ignores).
// The e2e user's login is generated on first use and kept in ~/.config/bot-e2e/<host>.json (0600), never in the repo.
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETS = { prod: 'https://sochitieu-btl.vercel.app', staging: 'https://sochitieu-btl-staging.vercel.app' };

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'prod' },
    reply: { type: 'string', multiple: true, default: [] },
    button: { type: 'string', multiple: true, default: [] },
    photo: { type: 'string' },
    out: { type: 'string' },
  },
});
const [command = 'help', stepId] = positionals;
const base = TARGETS[opts.target] ?? opts.target;
if (!/^https?:\/\//.test(base)) fail(`--target must be prod, staging or a URL, not "${opts.target}"`);
const { steps, receipts } = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));

function fail(text) {
  console.error(text);
  process.exit(1);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

// The e2e user's login for this host, created (and registered) the first time.
const credsFile = join(homedir(), '.config', 'bot-e2e', `${new URL(base).host}.json`);
async function login() {
  if (!existsSync(credsFile)) {
    const creds = { email: `bot-e2e-${randomBytes(4).toString('hex')}@example.com`, password: randomBytes(18).toString('base64url') };
    const { status, data } = await api('POST', '/auth/register', { body: { name: 'Bot E2E', ...creds, language: 'vi' } });
    if (status !== 201) fail(`register failed: ${status} ${data?.error?.code ?? ''}`);
    mkdirSync(dirname(credsFile), { recursive: true, mode: 0o700 });
    writeFileSync(credsFile, JSON.stringify(creds), { mode: 0o600 });
    chmodSync(credsFile, 0o600);
    console.log(`Created the e2e user ${creds.email} (login saved to ${credsFile})`);
    return data.accessToken;
  }
  const { status, data } = await api('POST', '/auth/login', { body: JSON.parse(readFileSync(credsFile, 'utf8')) });
  if (status !== 200) fail(`login failed: ${status} ${data?.error?.code ?? ''}`);
  return data.accessToken;
}

// Every page of one transaction status.
async function transactions(token, status) {
  const all = [];
  for (let page = 1; ; page++) {
    const { status: code, data } = await api('GET', `/transactions?status=${status}&limit=100&page=${page}`, { token });
    if (code !== 200) fail(`GET /transactions failed: ${code}`);
    all.push(...data.items);
    if (all.length >= data.total || data.items.length === 0) return all;
  }
}

// { links: ['telegram', …], drafts: ['telegram:45000', …], confirmed: […] }, each sorted, plus the raw rows.
async function readState(token) {
  const { status, data: links } = await api('GET', '/chat-links', { token });
  if (status !== 200) fail(`GET /chat-links failed: ${status}`);
  const [drafts, confirmed] = await Promise.all([transactions(token, 'draft'), transactions(token, 'confirmed')]);
  const keys = (rows) => rows.map((t) => `${t.source}:${t.amount}`).sort();
  return { links: links.map((l) => l.platform).sort(), drafts: keys(drafts), confirmed: keys(confirmed), rows: { links, drafts, confirmed } };
}

async function reset(token) {
  const { rows } = await readState(token);
  for (const t of [...rows.drafts, ...rows.confirmed]) await api('DELETE', `/transactions/${t.id}`, { token });
  for (const l of rows.links) await api('DELETE', `/chat-links/${l.id}`, { token });
  const after = await readState(token);
  if (after.links.length + after.drafts.length + after.confirmed.length > 0) fail(`reset left data behind: ${JSON.stringify(after)}`);
  console.log(`Reset: deleted ${rows.drafts.length + rows.confirmed.length} transaction(s), unlinked ${rows.links.length} chat(s).`);
}

const vnDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const outDir = () => resolve(opts.out ?? join(HERE, '..', '..', 'charter-runs', vnDate(), 'bot-e2e'));

// One step: every expected reply pattern must match one of the replies passed in, and the state must be exact.
async function checkStep(token) {
  let step = steps.find((s) => s.id === stepId?.toUpperCase());
  if (!step) fail(`Unknown step "${stepId}". Steps: ${steps.map((s) => s.id).join(' ')}`);
  // Receipt steps: {{total}} becomes the true total of the photo sent ("116000" in the state, "116\.000" in a reply).
  if (JSON.stringify(step).includes('{{total}}')) {
    const total = receipts[basename(opts.photo ?? '')];
    if (!total) fail(`${step.id} needs --photo <one of: ${Object.keys(receipts).join(', ')}>`);
    const amount = new Intl.NumberFormat('vi-VN').format(total).replaceAll('.', '\\.');
    const state = Object.fromEntries(Object.entries(step.state).map(([key, list]) => [key, list.map((x) => x.replace('{{total}}', total))]));
    step = { ...step, reply: step.reply.map((r) => r.replaceAll('{{total}}', amount)), state };
  }
  const replies = opts.reply;
  const problems = [];
  if (replies.length === 0) problems.push('no --reply given: pass the bot reply text as seen in the chat');
  for (const pattern of step.reply) {
    if (!replies.some((text) => new RegExp(pattern, 'u').test(text))) problems.push(`no reply matches /${pattern}/`);
  }
  for (const label of step.buttons ?? []) {
    if (!opts.button.includes(label)) problems.push(`no "${label}" button: pass each button under the reply with --button`);
  }
  const state = await readState(token);
  for (const key of ['links', 'drafts', 'confirmed']) {
    const want = [...step.state[key]].sort();
    if (JSON.stringify(state[key]) !== JSON.stringify(want)) problems.push(`${key}: expected [${want}] but the server has [${state[key]}]`);
  }
  const { links, drafts, confirmed } = state;
  const result = {
    id: step.id,
    title: step.title,
    status: problems.length ? 'fail' : 'pass',
    problems,
    replies,
    buttons: opts.button,
    ...(opts.photo && { photo: basename(opts.photo) }),
    state: { links, drafts, confirmed },
    at: new Date().toISOString(),
  };
  mkdirSync(outDir(), { recursive: true });
  appendFileSync(join(outDir(), 'results.jsonl'), `${JSON.stringify(result)}\n`);
  console.log(`${step.id} ${result.status.toUpperCase()}  ${step.title}`);
  problems.forEach((p) => console.log(`  - ${p}`));
  if (problems.length) process.exit(1);
}

const commands = {
  async setup() {
    await reset(await login());
  },
  async code() {
    const { status, data } = await api('POST', '/chat-links/code', { token: await login() });
    if (status !== 201) fail(`POST /chat-links/code failed: ${status} ${data?.error?.code ?? ''}`);
    console.log(JSON.stringify({ code: data.code, expiresAt: data.expiresAt, telegramDeepLink: data.telegramDeepLink }));
  },
  list() {
    for (const s of steps) {
      console.log(`${s.id} [${s.platform}]${s.optional ? ` (optional: ${s.optional})` : ''}  ${s.title}`);
      console.log(`  do:    ${s.do}`);
      console.log(`  reply: ${s.reply.map((r) => `/${r}/`).join(' and ')}${s.buttons ? `  buttons: ${s.buttons.join(' ')}` : ''}`);
      console.log(`  state: links [${s.state.links}] drafts [${s.state.drafts}] confirmed [${s.state.confirmed}]`);
    }
  },
  async step() {
    await checkStep(await login());
  },
  async state() {
    const { links, drafts, confirmed } = await readState(await login());
    console.log(JSON.stringify({ links, drafts, confirmed }));
  },
  async reset() {
    await reset(await login());
  },
};

if (commands[command]) await commands[command]();
else console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => /^\/\/ {3}|^\/\/ Options|^\/\/ {10}/.test(l)).join('\n'));
