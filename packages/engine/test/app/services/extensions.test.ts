import type { ContributionsDto, ExtensionInfoDto } from '@lms/engine-contract';
import { createFakeExtensionRegistry } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { createTestEngine } from '../../helpers/engine.ts';

const NO_CONTRIBUTES: ExtensionInfoDto['contributes'] = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

const info = (overrides: Partial<ExtensionInfoDto>): ExtensionInfoDto => ({
  id: 'lms.sql',
  version: '1.0.0',
  origin: 'bundled',
  state: 'loaded',
  contributes: { ...NO_CONTRIBUTES, exerciseTypes: ['lms.sql'] },
  message: null,
  ...overrides,
});

const open = (items?: ExtensionInfoDto[]) =>
  createTestEngine({
    extensionRegistry: createFakeExtensionRegistry(items),
  });

describe('extensions.list', () => {
  it('returns an empty list for an empty registry', async () => {
    const { engine } = await open();
    expect(await engine.extensions.list()).toEqual([]);
  });

  it('orders by id, then by origin priority bundled < user < dev', async () => {
    const { engine } = await open([
      info({ id: 'b.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'dev' }),
      info({ id: 'a.ext', origin: 'bundled', state: 'overridden' }),
      info({ id: 'a.ext', origin: 'user', state: 'overridden' }),
      info({ id: 'b.ext', origin: 'bundled' }),
    ]);
    const list = await engine.extensions.list();
    expect(list.map(({ id, origin }) => `${id}:${origin}`)).toEqual([
      'a.ext:bundled',
      'a.ext:user',
      'a.ext:dev',
      'b.ext:bundled',
      'b.ext:dev',
    ]);
  });

  it('returns copies: mutating the result does not affect the registry', async () => {
    const { engine } = await open([info({})]);
    const [first] = await engine.extensions.list();
    first?.contributes.exerciseTypes.push('evil');
    if (first !== undefined) first.message = 'changed';
    expect(await engine.extensions.list()).toEqual([info({})]);
  });
});

describe('extensions.contributions', () => {
  const theme = (id: string) => ({
    id,
    extensionId: 'a.ext',
    label: id,
    dark: false,
    colors: { background: '#ffffff' },
    variables: {},
  });
  const renderer = (language: string) => ({
    language,
    extensionId: 'a.ext',
    rendererUrl: `lms-ext://a.ext/${language}.mjs`,
  });
  const policy = (id: string) => ({
    id,
    extensionId: 'a.ext',
    label: id,
  });
  const contributions: ContributionsDto = {
    themes: [theme('a.ext.z'), theme('a.ext.b')],
    markdownRenderers: [renderer('math'), renderer('chart')],
    gradePolicies: [policy('a.ext.z'), policy('a.ext.b')],
  };
  const openWith = (source: ContributionsDto) =>
    createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([], source),
    });

  it('sorts themes by id, renderers by language, extension policies by id', async () => {
    const { engine } = await openWith(contributions);
    const result = await engine.extensions.contributions();
    expect(result.themes.map(({ id }) => id)).toEqual(['a.ext.b', 'a.ext.z']);
    expect(result.markdownRenderers.map(({ language }) => language)).toEqual([
      'chart',
      'math',
    ]);
    expect(result.gradePolicies.map(({ id }) => id).slice(1)).toEqual([
      'a.ext.b',
      'a.ext.z',
    ]);
  });

  it('prepends the built-in passAtN policy without extension or label', async () => {
    const { engine } = await open();
    expect((await engine.extensions.contributions()).gradePolicies).toEqual([
      { id: 'passAtN', extensionId: null, label: null },
    ]);
  });

  it('returns copies: mutating the result does not affect the registry', async () => {
    const { engine } = await openWith(contributions);
    const first = await engine.extensions.contributions();
    const [firstTheme] = first.themes;
    if (firstTheme !== undefined) firstTheme.colors['background'] = 'x';
    first.themes.pop();
    const second = await engine.extensions.contributions();
    expect(second.themes).toHaveLength(2);
    expect(second.themes[0]?.colors['background']).toBe('#ffffff');
  });
});
