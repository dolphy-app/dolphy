import type { CatalogEntry, CatalogVersion } from '../src/index.ts';

export const sha = (char: string): string => char.repeat(64);

export const version = (
  overrides: Partial<CatalogVersion> = {},
): CatalogVersion => ({
  version: '1.0.0',
  apiVersion: 1,
  minAppVersion: null,
  publishedAt: '2026-10-01T00:00:00Z',
  baseUrl: 'extensions/acme.quiz/1.0.0/',
  files: [
    { path: 'extension.json', size: 120, sha256: sha('a') },
    { path: 'main.mjs', size: 900, sha256: sha('b') },
  ],
  ...overrides,
});

export const entry = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'acme.quiz',
  name: 'Quiz',
  description: 'Вопросы с выбором',
  author: 'octo-cat',
  source: 'https://github.com/dolphy-app/dolphy-extensions',
  platforms: [],
  contributes: {
    exerciseTypes: ['acme.quiz'],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
  },
  versions: [version()],
  ...overrides,
});

export const index = (extensions: unknown[] = [entry()]): unknown => ({
  schemaVersion: 2,
  generatedAt: '2026-10-01T12:00:00Z',
  extensions,
  revoked: [{ id: 'acme.bad', versions: '<1.2.0', reason: 'security' }],
});
