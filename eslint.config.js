import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'public/tiles', 'pipeline/.venv'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked, reactRefresh.configs.vite],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      // Only the two long-standing hooks rules — eslint-plugin-react-hooks v7
      // also ships a bundle of React Compiler readiness rules (immutability,
      // static-components, etc.) under its "recommended" preset; this project
      // doesn't use the compiler, and those rules flag things like mutating a
      // plain DOM element passed in as a prop (App.tsx's mapContainer/arContainer),
      // which is a deliberate, contained pattern here, not a bug.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Standard mitigation for async React event handlers (e.g. an async
      // onClick) — React doesn't await the return value, so a Promise-returning
      // handler is fine; only flag a mismatched void return elsewhere (a
      // Promise passed where a plain callback is genuinely required).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    files: ['*.config.{js,ts}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
