import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-server/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/e2e/**/*.tsx'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    // Classic hook rules only; the React Compiler rules assume a compiler build.
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', 'docker/**/*.mjs', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  // Playwright fixtures declare unused dependencies as `async ({}, use) => …`.
  { files: ['tests/e2e/**/*.ts'], rules: { 'no-empty-pattern': 'off' } },
);
