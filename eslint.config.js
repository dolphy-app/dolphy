const metarhia = require('eslint-config-metarhia');
const prettier = require('eslint-config-prettier');
const tseslint = require('typescript-eslint');
const vue = require('eslint-plugin-vue');
const globals = require('globals');

const SOURCE_FILES = ['**/*.{ts,mts,vue}'];

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/dist-e2e/**',
      '**/release/**',
      'vendor/**',
      'docs/**',
      'engine-ts/**',
      'spike/**',
    ],
  },
  ...metarhia,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: SOURCE_FILES,
  })),
  ...vue.configs['flat/recommended'],
  {
    files: SOURCE_FILES,
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      strict: 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // wire-форматы Trane и ts-fsrs — snake_case: ключи объектов не переименовываем
      camelcase: ['error', { properties: 'never' }],
      '@typescript-eslint/no-unused-vars': 'error',
      'vue/multi-word-component-names': ['error', { ignores: ['App'] }],
    },
  },
  prettier,
];
