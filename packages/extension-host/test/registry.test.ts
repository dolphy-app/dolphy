import { describe, expect, it } from 'vitest';
import type { DiscoveryResult, ResolvedExtension } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';

const extension = (id: string, version = '1.0.0'): ResolvedExtension => ({
  id,
  version,
  origin: 'user',
  dir: `/x/${id}`,
  mainPath: `/x/${id}/main.mjs`,
  permissions: ['library.read'],
  exerciseTypes: [
    {
      id: `${id}.a`,
      specSchema: {},
      answerSchema: {},
      element: 'x-a',
      rendererUrl: 'lms-ext://x/view.mjs',
    },
  ],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
});

const NONE = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
};

const discovery: DiscoveryResult = {
  extensions: [extension('lms.sql', '1.0.1')],
  overridden: [
    {
      id: 'lms.sql',
      version: '1.0.0',
      origin: 'bundled',
      by: { origin: 'user', version: '1.0.1' },
    },
  ],
  diagnostics: [
    { extensionId: 'broken-dir', origin: 'user', message: 'bad manifest' },
  ],
};

describe('createExtensionRegistry', () => {
  const items = createExtensionRegistry(
    discovery,
    createExtensionPolicy(discovery),
  ).list();

  it('maps loaded extensions with their exercise types', () => {
    expect(items).toContainEqual({
      id: 'lms.sql',
      version: '1.0.1',
      origin: 'user',
      state: 'loaded',
      contributes: { ...NONE, exerciseTypes: ['lms.sql.a'] },
      message: null,
      permissions: ['library.read'],
      isolation: 'isolated',
      toggleable: true,
    });
  });

  it('maps overridden copies with the overriding origin and version', () => {
    expect(items).toContainEqual({
      id: 'lms.sql',
      version: '1.0.0',
      origin: 'bundled',
      state: 'overridden',
      contributes: NONE,
      message: 'overridden by user 1.0.1',
      permissions: [],
      isolation: 'trusted',
      toggleable: false,
    });
  });

  it('maps diagnostics to invalid entries without a version', () => {
    expect(items).toContainEqual({
      id: 'broken-dir',
      version: null,
      origin: 'user',
      state: 'invalid',
      contributes: NONE,
      message: 'bad manifest',
      permissions: [],
      isolation: 'isolated',
      toggleable: false,
    });
  });

  it('returns copies', () => {
    const registry = createExtensionRegistry(
      discovery,
      createExtensionPolicy(discovery),
    );
    registry.list()[0]?.contributes.exerciseTypes.push('evil');
    expect(registry.list()[0]?.contributes.exerciseTypes).toEqual([
      'lms.sql.a',
    ]);
  });
});

describe('createExtensionRegistry: политика', () => {
  const bundled: ResolvedExtension = {
    ...extension('lms.math'),
    origin: 'bundled',
    permissions: [],
    markdownRenderers: [
      {
        language: 'math',
        rendererUrl: 'lms-ext://lms.math/view.mjs',
      },
    ],
  };
  const user: ResolvedExtension = {
    ...extension('acme.u'),
    markdownRenderers: [
      {
        language: 'chart',
        rendererUrl: 'lms-ext://acme.u/view.mjs',
      },
    ],
    themes: [
      {
        id: 'acme.u.night',
        label: 'Night',
        dark: true,
        colors: { background: '#000000' },
        variables: {},
      },
    ],
  };
  const both: DiscoveryResult = {
    extensions: [bundled, user],
    overridden: [],
    diagnostics: [],
  };

  it('отключённое расширение в списке со state disabled, без вкладов', () => {
    const policy = createExtensionPolicy(both);
    const registry = createExtensionRegistry(both, policy);
    policy.update({ disabled: ['acme.u'], trusted: [] });
    const item = registry.list().find(({ id }) => id === 'acme.u');
    expect(item).toMatchObject({
      state: 'disabled',
      message: null,
      toggleable: true,
      contributes: { themes: ['acme.u.night'], markdownRenderers: ['chart'] },
    });
    const { themes, markdownRenderers } = registry.contributions();
    expect(themes).toEqual([]);
    expect(markdownRenderers.map(({ language }) => language)).toEqual(['math']);
  });

  it('isolation и isolated: поставка — доверена, доверенное пользователем — тоже', () => {
    const policy = createExtensionPolicy(both);
    const registry = createExtensionRegistry(both, policy);
    const flags = () =>
      Object.fromEntries(
        registry
          .contributions()
          .markdownRenderers.map((renderer) => [
            renderer.language,
            renderer.isolated,
          ]),
      );
    expect(flags()).toEqual({ math: false, chart: true });
    expect(
      registry
        .list()
        .map(({ id, isolation, toggleable }) => [id, isolation, toggleable]),
    ).toEqual([
      ['lms.math', 'trusted', false],
      ['acme.u', 'isolated', true],
    ]);
    policy.update({ disabled: [], trusted: ['acme.u', 'lms.math'] });
    expect(flags()).toEqual({ math: false, chart: false });
    expect(registry.list().map(({ isolation }) => isolation)).toEqual([
      'trusted',
      'trusted',
    ]);
  });
});
