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

// pytest's own JUnit file (agent/tests, TC-F14-16): its conftest puts the case ID from the docstring at the start of the
// name, a parametrized test ends with its parameter, and a test with no ID keeps its function name.
const pytestXml = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="4" time="2.1">
<testcase classname="tests.test_http" name="TC-F14-04 GET /health answers without a secret with only vllm, embedder, model and gpuFreeMb" time="0.011" />
<testcase classname="tests.test_http" name="TC-F14-05 A missing or wrong bearer is 401 on /v1/* and on every other path except /health [POST-/v1/turn]" time="0.018"><failure message="assert 200 == 401">trace</failure></testcase>
<testcase classname="tests.test_startup" name="TC-F14-06 With both variables set the service still exits while models.lock holds a placeholder" time="0.2"><skipped type="pytest.skip" message="models.lock is pinned">skip</skipped></testcase>
<testcase classname="tests.test_x" name="test_without_a_case_id" time="0.001" />
</testsuite></testsuites>`;

const py = parseJunit(pytestXml);
assert.equal(py.length, 4);
assert.deepEqual(py.map((t) => t.result), ['Pass', 'Fail', 'Skipped', 'Pass']);
assert.deepEqual(py.map((t) => ID_RE.exec(t.name)?.[1] ?? null), ['TC-F14-04', 'TC-F14-05', 'TC-F14-06', null]);
console.log('junit.mjs reads pytest output OK');
