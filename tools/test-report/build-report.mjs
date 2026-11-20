#!/usr/bin/env node
// Builds docs/testing/test-report.xlsx.
// Inputs (docs/testing/): test-cases.json, bugs.json, runs.json, results.json (created on first JUnit import).
// Usage: node build-report.mjs [--junit path.xml]... [--env local|production]
// With --junit, each <testcase> whose name starts with a case ID (TC-F1-01, MT-03, ...) updates that case's
// latest result (results.json) and a new row is appended to runs.json. Edit the JSON files, not the Excel:
// the workbook is regenerated every time.
import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_RE, parseJunit } from './junit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = resolve(ROOT, 'docs/testing');
const OUT = resolve(DIR, 'test-report.xlsx');
const readJson = (name, fallback) => {
  const path = resolve(DIR, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
};
const writeJson = (name, data) => writeFileSync(resolve(DIR, name), JSON.stringify(data, null, 2) + '\n');

// ---------- CLI ----------
const argv = process.argv.slice(2);
const junitFiles = [];
let env = 'local';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--junit') junitFiles.push(argv[++i]);
  else if (argv[i] === '--env') env = argv[++i];
  else throw new Error(`Unknown argument: ${argv[i]}`);
}

const cases = readJson('test-cases.json', []);
const bugs = readJson('bugs.json', []);
const runs = readJson('runs.json', []);
const results = readJson('results.json', {});

// ---------- JUnit import ----------
if (junitFiles.length) {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const runId = `RUN-${String(runs.length + 1).padStart(3, '0')}`;
  const tests = junitFiles.flatMap((f) => parseJunit(readFileSync(resolve(f), 'utf8')));
  const byId = {};
  for (const t of tests) {
    const id = ID_RE.exec(t.name)?.[1];
    if (!id) continue;
    // A case can map to several tests: any Fail wins, then Pass, then Skipped.
    const prev = byId[id];
    byId[id] = prev === 'Fail' || t.result === 'Fail' ? 'Fail' : prev === 'Pass' || t.result === 'Pass' ? 'Pass' : 'Skipped';
  }
  for (const [id, result] of Object.entries(byId)) results[id] = { result, run: runId, date: now };
  const count = (r) => tests.filter((t) => t.result === r).length;
  runs.push({
    id: runId,
    date: now,
    env,
    suite: junitFiles.map((f) => basename(f)).join(', '),
    total: tests.length,
    passed: count('Pass'),
    failed: count('Fail'),
    skipped: count('Skipped'),
    durationSec: Math.round(tests.reduce((s, t) => s + t.time, 0)),
    notes: `${Object.keys(byId).length} catalogue cases matched; ${tests.filter((t) => !ID_RE.test(t.name)).length} tests without a case ID`,
  });
  writeJson('results.json', results);
  writeJson('runs.json', runs);
}

// ---------- Workbook ----------
const wb = new ExcelJS.Workbook();
wb.creator = 'Zalo-Tele Integrated Financial App';
wb.created = new Date();
wb.calcProperties.fullCalcOnLoad = true;

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E5F' } };
const RED = { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8D7DA' } };
const GREEN = { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFD4EDDA' } };
const AMBER = { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF3CD' } };
const MAX_ROWS = 1000;

const RESULTS = ['Pass', 'Fail', 'Skipped', 'Not run'];
const SEVERITIES = ['S1 Critical', 'S2 Major', 'S3 Minor', 'S4 Cosmetic'];
const STATUSES = ['Open', 'In progress', 'Fixed (awaiting retest)', 'Closed', "Won't fix", 'Blocked'];

function table(ws, columns, rows) {
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  rows.forEach((r) => ws.addRow(r));
  ws.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

function listValidation(ws, col, values) {
  for (let r = 2; r <= MAX_ROWS; r++) {
    ws.getCell(`${col}${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${values.join(',')}"`],
      showErrorMessage: true,
      error: `Use one of: ${values.join(', ')}`,
    };
  }
}

function highlight(ws, col, lastCol, rules) {
  ws.addConditionalFormatting({
    ref: `A2:${lastCol}${MAX_ROWS}`,
    rules: rules.map(([text, fill], i) => ({
      type: 'expression',
      priority: i + 1,
      formulae: [`$${col}2="${text}"`],
      style: { fill },
    })),
  });
}

// --- Summary first, so it is the sheet that opens (formulas fill in on open) ---
const sm = wb.addWorksheet('Summary');

// --- Test Cases ---
const tc = wb.addWorksheet('Test Cases');
table(
  tc,
  [
    ['ID', 'id', 11], ['Feature', 'feature', 16], ['Level', 'level', 12], ['Tool', 'tool', 20], ['Priority', 'priority', 8],
    ['Title', 'title', 34], ['Steps', 'steps', 48], ['Expected result', 'expected', 48],
    ['What this test proves', 'proves', 48], ['Last result', 'lastResult', 11], ['Last run', 'lastRun', 18], ['Evidence', 'evidence', 30],
  ],
  cases.map((c) => ({
    ...c,
    lastResult: results[c.id]?.result ?? 'Not run',
    lastRun: results[c.id] ? `${results[c.id].run} · ${results[c.id].date}` : '',
    evidence: results[c.id]?.evidence ?? c.evidence ?? '',
  })),
);
listValidation(tc, 'J', RESULTS);
highlight(tc, 'J', 'L', [['Fail', RED], ['Pass', GREEN], ['Skipped', AMBER]]);

// --- Bugs ---
const bg = wb.addWorksheet('Bugs');
table(
  bg,
  [
    ['Bug ID', 'id', 10], ['Date found', 'dateFound', 12], ['Found by (test ID)', 'foundBy', 14], ['Feature', 'feature', 16],
    ['Severity', 'severity', 13], ['Title', 'title', 34], ['Steps to reproduce', 'stepsToReproduce', 40], ['Expected', 'expected', 30],
    ['Actual', 'actual', 30], ['Root cause', 'rootCause', 40], ['How it was refined (fix)', 'fix', 44], ['Files / commit', 'filesOrCommit', 26],
    ['Regression test', 'regressionTest', 16], ['Status', 'status', 16], ['Date closed', 'dateClosed', 12], ['Evidence', 'evidence', 30],
  ],
  bugs,
);
listValidation(bg, 'E', SEVERITIES);
listValidation(bg, 'N', STATUSES);
highlight(bg, 'N', 'P', [['Open', RED], ['In progress', AMBER], ['Fixed (awaiting retest)', AMBER], ['Blocked', RED], ['Closed', GREEN]]);

// --- Runs ---
const rn = wb.addWorksheet('Runs');
table(
  rn,
  [
    ['Run ID', 'id', 10], ['Date', 'date', 17], ['Environment', 'env', 12], ['Suite', 'suite', 30], ['Total', 'total', 8],
    ['Passed', 'passed', 8], ['Failed', 'failed', 8], ['Skipped', 'skipped', 8], ['Duration (s)', 'durationSec', 11], ['Notes', 'notes', 50],
  ],
  runs,
);

// --- Summary content (live formulas, so status edits made in Excel still count) ---
sm.columns = [{ width: 52 }, { width: 14 }, { width: 10 }, { width: 10 }];
sm.addRow(['Test & Bug Report: Zalo-Tele Integrated Financial App']).font = { bold: true, size: 14 };
sm.addRow([`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from docs/testing/*.json`]).font = { italic: true, color: { argb: 'FF666666' } };
sm.addRow([]);
const TCR = `'Test Cases'!$J$2:$J$${MAX_ROWS}`;
const TCP = `'Test Cases'!$E$2:$E$${MAX_ROWS}`;
const TCF = `'Test Cases'!$B$2:$B$${MAX_ROWS}`;
const BS = `Bugs!$N$2:$N$${MAX_ROWS}`;
const BV = `Bugs!$E$2:$E$${MAX_ROWS}`;
const section = (title) => {
  const r = sm.addRow([title]);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = HEADER_FILL;
};
const metric = (label, formula, fmt) => {
  const r = sm.addRow([label, { formula }]);
  if (fmt) r.getCell(2).numFmt = fmt;
  return r.number;
};

section('Test cases');
metric('Total cases', `COUNTA('Test Cases'!$A$2:$A$${MAX_ROWS})`);
const pass = metric('Pass', `COUNTIF(${TCR},"Pass")`);
const fail = metric('Fail', `COUNTIF(${TCR},"Fail")`);
metric('Skipped', `COUNTIF(${TCR},"Skipped")`);
metric('Not run', `COUNTIF(${TCR},"Not run")`);
metric('Pass rate (of executed)', `IFERROR(B${pass}/(B${pass}+B${fail}),0)`, '0.0%');
const p0fail = metric('P0 cases failing', `COUNTIFS(${TCP},"P0",${TCR},"Fail")`);
const p0notrun = metric('P0 cases not run', `COUNTIFS(${TCP},"P0",${TCR},"Not run")`);
sm.addRow([]);
section('Bugs');
metric('Total bugs', `COUNTA(Bugs!$A$2:$A$${MAX_ROWS})`);
for (const s of STATUSES) metric(`Status: ${s}`, `COUNTIF(${BS},"${s}")`);
for (const s of SEVERITIES) metric(`Severity: ${s}`, `COUNTIF(${BV},"${s}")`);
const openS12 = metric(
  "Open S1/S2 (not Closed / Won't fix)",
  `COUNTIFS(${BV},"S1 Critical",${BS},"<>Closed",${BS},"<>Won't fix")+COUNTIFS(${BV},"S2 Major",${BS},"<>Closed",${BS},"<>Won't fix")`,
);
sm.addRow([]);
section('Demo exit criteria');
const ready = metric(
  'Ready for demo? (no open S1/S2, all P0 run and passing)',
  `IF(AND(B${openS12}=0,B${p0fail}=0,B${p0notrun}=0),"YES","NO")`,
);
sm.getCell(`B${ready}`).font = { bold: true };
sm.addRow([]);
section('By feature');
sm.addRow(['Feature', 'Cases', 'Pass', 'Fail']).font = { bold: true };
for (const f of [...new Set(cases.map((c) => c.feature))]) {
  sm.addRow([
    f,
    { formula: `COUNTIF(${TCF},"${f}")` },
    { formula: `COUNTIFS(${TCF},"${f}",${TCR},"Pass")` },
    { formula: `COUNTIFS(${TCF},"${f}",${TCR},"Fail")` },
  ]);
}

// --- Legend ---
const lg = wb.addWorksheet('Legend');
lg.columns = [{ width: 26 }, { width: 90 }];
const lrow = (a, b, isHeader = false) => {
  const r = lg.addRow([a, b]);
  r.alignment = { wrapText: true, vertical: 'top' };
  if (isHeader) {
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = HEADER_FILL;
  }
};
lrow('How this file is made', 'Regenerated by tools/test-report/build-report.mjs. Edit docs/testing/*.json (or let Claude do it), not this workbook: manual edits here are overwritten on the next run.');
lrow('Severity', 'Meaning', true);
lrow('S1 Critical', "Data loss, security hole, or a core flow broken (e.g. user B can read user A's transactions)");
lrow('S2 Major', 'A feature doesn\'t work and there is no workaround (e.g. Zalo "ok" doesn\'t confirm)');
lrow('S3 Minor', 'Works but wrong in some cases (e.g. daily chart off by one day at midnight)');
lrow('S4 Cosmetic', 'Visual or text only (e.g. untranslated label)');
lrow('Status', 'Meaning', true);
lrow('Open', 'Seen and logged, not yet worked on');
lrow('In progress', 'Reproduced with a failing test; fix being made');
lrow('Fixed (awaiting retest)', 'Fix committed; waiting for the full suite / charter to pass');
lrow('Closed', 'Regression test passes and the full suite is green');
lrow("Won't fix / Blocked", 'Not fixed, with the reason in "How it was refined" (Blocked = needs a decision from the owner)');
lrow('Test result', 'Meaning', true);
lrow('Pass / Fail / Skipped', 'From the latest JUnit run (Vitest / Playwright) or a recorded manual session');
lrow('Not run', 'No result recorded yet');
lrow('Bug column', 'How to fill', true);
lrow('Found by (test ID)', 'The test case or charter that exposed it, e.g. TC-F8-05 or MT-03');
lrow('Root cause', 'Why it happened (the real cause, not the symptom), e.g. "parser read 1tr2 as 1,000,002"');
lrow('How it was refined (fix)', 'What was changed and why, e.g. "added tr<digits> rule: the digits after tr are hundreds of thousands"');
lrow('Regression test', 'The test that now guards it (usually the same ID as "Found by", or a new one)');
lrow('Evidence', 'Path to a GIF / screenshot / Playwright trace under docs/testing/recordings/');
lrow('Refine loop', 'Run → triage → reproduce with a failing test → diagnose root cause → fix → rerun failing test → rerun full suite → update bugs.json → regenerate this file');

await wb.xlsx.writeFile(OUT);
console.log(
  `Wrote ${OUT}: ${cases.length} cases, ${bugs.length} bugs, ${runs.length} runs` +
    (junitFiles.length ? `, imported ${junitFiles.length} JUnit file(s)` : ''),
);
