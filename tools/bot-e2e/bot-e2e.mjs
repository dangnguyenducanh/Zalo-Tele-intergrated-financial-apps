#!/usr/bin/env node
// Real-chat bot e2e checker (docs/testing/bot-e2e.md). Someone types the steps of scenarios.json into the real
// Telegram and Zalo chats with the deployed bots (Claude through Claude in Chrome on Telegram Web and Zalo Web,
// or a person on a phone); after each step this tool checks the bot's replies, as read off the screen, and the
// server state of a dedicated e2e web user through the public API. No dependencies, Node 20+.
//
//   node tools/bot-e2e/bot-e2e.mjs setup              empty the e2e user: no transactions, no budgets this month, no chat links
//   node tools/bot-e2e/bot-e2e.mjs code               a fresh link code (and the Telegram deep link) for TG-01 / ZL-01
//   node tools/bot-e2e/bot-e2e.mjs list               every step: what to do, the expected replies and state
//   node tools/bot-e2e/bot-e2e.mjs step <ID> --reply "<text>" [--reply "<text>"]… [--button "<label>"]…
//                                                     check one step; exit 1 when a reply, a button or the state is wrong
//                                                     (receipt steps also take --photo <file>: its true total is expected)
//   node tools/bot-e2e/bot-e2e.mjs state              the e2e user's server state as JSON
//   node tools/bot-e2e/bot-e2e.mjs budget "<category>" <limit>   this month's budget for a category (ZL-14)
//   node tools/bot-e2e/bot-e2e.mjs reset              delete the e2e user's transactions and this month's budgets, unlink its chats
// Options: -h/--help this usage, --target prod|staging|<https URL> (default prod), --out <dir> for results.jsonl
//          (default charter-runs/<VN date>/bot-e2e/ in the repo, which git ignores).
//          Every command but list and help needs the e2e login in ~/.config/bot-e2e/<host>.json; without it the tool says how to create it.
// The e2e user is made by hand once (register on the website with a real inbox) and its login kept in
// ~/.config/bot-e2e/<host>.json (0600) as {"email","password"}, never in the repo. Without that file a command that
// needs a login prints how to create it and exits 1; the tool never signs up.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGETS = { prod: 'https://sochitieu-btl.vercel.app', staging: 'https://sochitieu-btl-staging.vercel.app' };

// The usage is the comment block at the top of this file.
function usage() {
  return readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => /^\/\/ {3}|^\/\/ Options|^\/\/ {10}/.test(l)).join('\n');
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string', default: 'prod' },
      reply: { type: 'string', multiple: true, default: [] },
      button: { type: 'string', multiple: true, default: [] },
      photo: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (error) {
  // An unknown option or a missing value: one line and the usage, like an unknown command (BUG-007).
  if (!error.code?.startsWith('ERR_PARSE_ARGS_')) throw error;
  console.error(`${error.message}\n`);
  console.log(usage());
  process.exit(1);
}
const { values: opts, positionals } = args;
if (opts.help) {
  console.log(usage());
  process.exit(0);
}
const [command = 'help', stepId, budgetLimit] = positionals; // budget: stepId is the category name
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
  }).catch(() => fail(`Cannot reach ${base}: is the site up and --target right?`));
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

// The e2e user's login for this host. The tool never signs up: with e-mail codes on, a sign-up would send to an
// address that bounces, so the file is made once by hand (docs/testing/bot-e2e.md).
const credsFile = join(homedir(), '.config', 'bot-e2e', `${new URL(base).host}.json`);
async function login() {
  if (!existsSync(credsFile)) {
    fail(
      `No login for ${new URL(base).host}. Register on the website (${base}/register) with an inbox you can read, then save\n` +
        `{"email":"<that email>","password":"<that password>"} to ${credsFile}\nand run: chmod 600 ${credsFile}`,
    );
  }
  let creds;
  try {
    creds = JSON.parse(readFileSync(credsFile, 'utf8'));
  } catch {
    fail(`${credsFile} is not valid JSON: it must hold {"email":"<that email>","password":"<that password>"}`);
  }
  const { status, data } = await api('POST', '/auth/login', { body: creds });
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

const vnDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const thisMonth = () => vnDate().slice(0, 7);

async function reset(token) {
  const { rows } = await readState(token);
  const { data: budgets } = await api('GET', `/budgets?month=${thisMonth()}`, { token });
  for (const t of [...rows.drafts, ...rows.confirmed]) await api('DELETE', `/transactions/${t.id}`, { token });
  for (const b of budgets ?? []) await api('DELETE', `/budgets/${b.id}`, { token });
  for (const l of rows.links) await api('DELETE', `/chat-links/${l.id}`, { token });
  const after = await readState(token);
  if (after.links.length + after.drafts.length + after.confirmed.length > 0) fail(`reset left data behind: ${JSON.stringify(after)}`);
  console.log(
    `Reset: deleted ${rows.drafts.length + rows.confirmed.length} transaction(s) and ${budgets?.length ?? 0} budget(s), unlinked ${rows.links.length} chat(s).`,
  );
}

// This month's budget for one of the e2e user's categories, by its Vietnamese name ("Đi lại"), for the /month step.
async function addBudget(token) {
  const limit = Number(budgetLimit);
  if (!stepId || !(limit > 0)) fail('usage: budget "<category>" <limit>, e.g. budget "Đi lại" 80000');
  const { data: categories } = await api('GET', '/categories', { token });
  const category = categories?.find((c) => c.type === 'expense' && (c.name || c.names?.vi) === stepId);
  if (!category) fail(`No expense category named "${stepId}"`);
  const { status, data } = await api('POST', '/budgets', { token, body: { month: thisMonth(), categoryId: category.id, limit } });
  if (status !== 201) fail(`POST /budgets failed: ${status} ${data?.error?.code ?? ''}`);
  console.log(`Budget ${thisMonth()} "${stepId}": ${limit}`);
}
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
    console.log(JSON.stringify({ code: data.code, expiresAt: data.expiresAt, links: data.links }));
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
  async budget() {
    await addBudget(await login());
  },
  async reset() {
    await reset(await login());
  },
};

if (commands[command]) await commands[command]();
else {
  if (command !== 'help') console.error(`Unknown command "${command}".\n`);
  console.log(usage());
  if (command !== 'help') process.exit(1);
}
