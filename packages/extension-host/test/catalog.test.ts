import { describe, expect, it } from 'vitest';
import { holderOf, resolvedOf } from './helpers.ts';
import { createCatalog, exerciseTypeIssue } from '../src/catalog.ts';
import {
  createAllEnabledPolicy,
  createExtensionPolicy,
} from '../src/policy.ts';

const exerciseType = {
  id: 'acme.t',
  title: null,
  specSchema: {
    type: 'object',
    required: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    properties: { a: { type: 'string' } },
  },
  answerSchema: { type: 'string' },
};

const extension = resolvedOf(
  'acme.t',
  { exerciseTypes: [exerciseType] },
  { version: '2.0.0', origin: 'bundled' },
);

describe('exerciseTypeIssue', () => {
  it('null для компилируемых схем', () => {
    expect(exerciseTypeIssue([exerciseType])).toBeNull();
    expect(exerciseTypeIssue([])).toBeNull();
  });

  it('текст ошибки для несжимаемой схемы, с видом и полем', () => {
    const issue = exerciseTypeIssue([
      exerciseType,
      { ...exerciseType, id: 'acme.bad', answerSchema: { type: 'nope' } },
    ]);
    expect(issue).toMatch(/^exercise type 'acme\.bad': answerSchema /);
  });
});

describe('createCatalog', () => {
  const catalog = createCatalog(
    holderOf([extension]),
    createAllEnabledPolicy(),
  );

  it('описывает вид и владельца', () => {
    expect(catalog.describe('acme.t')).toEqual({
      type: 'acme.t',
      extensionId: 'acme.t',
      extensionVersion: '2.0.0',
    });
    expect(catalog.list()).toHaveLength(1);
    expect(catalog.ownerOf('acme.t')?.id).toBe('acme.t');
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
  const withPolicies = resolvedOf(
    'acme.t',
    {
      exerciseTypes: [exerciseType],
      gradePolicies: [{ id: 'acme.t.generous', label: 'Generous' }],
    },
    { version: '2.0.0', origin: 'bundled' },
  );
  const catalog = createCatalog(
    holderOf([withPolicies]),
    createAllEnabledPolicy(),
  );

  it('описывает правила и владельца', () => {
    expect(catalog.describePolicies()).toEqual([
      { id: 'acme.t.generous', label: 'Generous', extensionId: 'acme.t' },
    ]);
    expect(catalog.ownerOfPolicy('acme.t.generous')?.id).toBe('acme.t');
    expect(catalog.ownerOfPolicy('acme.t.other')).toBeUndefined();
  });
});

describe('createCatalog: отключённые расширения', () => {
  const withPolicy = resolvedOf(
    'acme.t',
    {
      exerciseTypes: [exerciseType],
      gradePolicies: [{ id: 'acme.t.generous', label: 'Generous' }],
    },
    { origin: 'user' },
  );
  const holder = holderOf([withPolicy]);
  const policy = createExtensionPolicy(holder);
  const catalog = createCatalog(holder, policy);

  it('ведёт себя так, будто расширения нет, и сразу возвращается при включении', () => {
    policy.update({
      disabled: ['acme.t'],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(catalog.describe('acme.t')).toBeUndefined();
    expect(catalog.list()).toEqual([]);
    expect(catalog.ownerOf('acme.t')).toBeUndefined();
    expect(catalog.ownerOfPolicy('acme.t.generous')).toBeUndefined();
    expect(catalog.describePolicies()).toEqual([]);
    expect(catalog.validateSpec('acme.t', {})).toEqual([
      'unknown exercise type',
    ]);
    expect(catalog.validateAnswer('acme.t', 'x')).toEqual([
      'unknown exercise type',
    ]);
    policy.update({
      disabled: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
    expect(catalog.describe('acme.t')?.extensionId).toBe('acme.t');
    expect(catalog.list()).toHaveLength(1);
    expect(catalog.ownerOfPolicy('acme.t.generous')?.id).toBe('acme.t');
  });
});
