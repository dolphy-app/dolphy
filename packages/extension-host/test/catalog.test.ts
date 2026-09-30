import { describe, expect, it } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import type { ResolvedExtension } from '../src/discover.ts';

const extension: ResolvedExtension = {
  id: 'acme.t',
  version: '2.0.0',
  origin: 'bundled',
  dir: '/x/acme.t',
  mainPath: '/x/acme.t/main.mjs',
  exerciseTypes: [
    {
      id: 'acme.t',
      specSchema: {
        type: 'object',
        required: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        properties: { a: { type: 'string' } },
      },
      answerSchema: { type: 'string' },
      element: 'acme-t-answer',
      rendererUrl: 'lms-ext://acme.t/view.mjs',
    },
  ],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

describe('createCatalog', () => {
  const catalog = createCatalog([extension]);

  it('описывает вид и владельца', () => {
    expect(catalog.describe('acme.t')).toEqual({
      type: 'acme.t',
      extensionId: 'acme.t',
      extensionVersion: '2.0.0',
      element: 'acme-t-answer',
      rendererUrl: 'lms-ext://acme.t/view.mjs',
    });
    expect(catalog.list()).toHaveLength(1);
    expect(catalog.ownerOf('acme.t')).toBe(extension);
    expect(catalog.describe('nope')).toBeUndefined();
    expect(catalog.ownerOf('nope')).toBeUndefined();
  });

  it('validateSpec возвращает не более 6 сообщений', () => {
    const issues = catalog.validateSpec('acme.t', {});
    expect(issues).toHaveLength(6);
    expect(issues[0]).toMatch(/^\/ /);
  });

  it('пустой результат для подходящего spec, путь в сообщении', () => {
    const spec = Object.fromEntries('abcdefgh'.split('').map((k) => [k, 'x']));
    expect(catalog.validateSpec('acme.t', spec)).toEqual([]);
    expect(catalog.validateSpec('acme.t', { ...spec, a: 1 })).toEqual([
      '/a must be string',
    ]);
  });

  it('validateAnswer проверяет схему ответа', () => {
    expect(catalog.validateAnswer('acme.t', 'x')).toEqual([]);
    expect(catalog.validateAnswer('acme.t', 5)).toHaveLength(1);
  });

  it('неизвестный вид', () => {
    expect(catalog.validateSpec('nope', {})).toEqual(['unknown exercise type']);
    expect(catalog.validateAnswer('nope', '')).toEqual([
      'unknown exercise type',
    ]);
  });
});

describe('createCatalog: правила оценки', () => {
  const withPolicies: ResolvedExtension = {
    ...extension,
    gradePolicies: [{ id: 'acme.t.generous', label: 'Generous' }],
  };
  const catalog = createCatalog([extension, withPolicies]);

  it('описывает правила и владельца', () => {
    expect(catalog.describePolicies()).toEqual([
      { id: 'acme.t.generous', label: 'Generous', extensionId: 'acme.t' },
    ]);
    expect(catalog.ownerOfPolicy('acme.t.generous')?.id).toBe('acme.t');
    expect(catalog.ownerOfPolicy('acme.t.other')).toBeUndefined();
  });
});
