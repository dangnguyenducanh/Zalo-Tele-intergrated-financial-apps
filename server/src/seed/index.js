// Entry point for `npm run seed` (default category templates + first admin, task T05) and
// `npm run seed:test` (test users and fixtures, task T16). Nothing to seed yet.
const mode = process.argv.includes('--test') ? 'test data' : 'defaults';
console.info(`Seed (${mode}): nothing to seed yet.`);
