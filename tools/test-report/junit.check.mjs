// Self-check for junit.mjs: node junit.check.mjs (exits non-zero on failure).
import assert from 'node:assert/strict';
import { ID_RE, parseJunit } from './junit.mjs';

const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="api">
  <testcase name="TC-F1-01 register stores bcrypt hash" time="0.21"/>
  <testcase name="TC-F1-05 refresh rotates token" time="0.40"><failure message="expected 401">stack</failure></testcase>
  <testcase name="TC-F8-03 webhook secret" time="0.05"><skipped/></testcase>
  <testcase name="helper without id" time="0.01"></testcase>
  <testcase name="MT-02 telegram e2e" time="1.5"><error message="boom"/></testcase>
</testsuite></testsuites>`;

const r = parseJunit(xml);
assert.equal(r.length, 5);
assert.deepEqual(r.map((t) => t.result), ['Pass', 'Fail', 'Skipped', 'Pass', 'Fail']);
assert.equal(r[1].time, 0.4);
assert.deepEqual(r.map((t) => ID_RE.exec(t.name)?.[1] ?? null), ['TC-F1-01', 'TC-F1-05', 'TC-F8-03', null, 'MT-02']);
console.log('junit.mjs OK');
