import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVars = ['error', { argsIgnorePattern: '^_' }];

export default defineConfig([
  globalIgnores(['**/dist', '**/test-results', '**/playwright-report', '**/node_modules']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': unusedVars },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // App code logs through console.info/warn/error only; console.log is debugging left behind.
    files: ['server/src/**/*.js', 'client/src/**/*.{ts,tsx}'],
    rules: { 'no-console': ['error', { allow: ['info', 'warn', 'error'] }] },
  },
]);
