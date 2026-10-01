import { describe, expect, it } from 'vitest';
import { createDiscoveryHolder } from '../src/holder.ts';
import type { DiscoveryResult, ResolvedExtension } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';

const extension = (id: string, version = '1.0.0'): ResolvedExtension => ({
  id,
  version,
  origin: 'user',
  revision: '',
  dir: `/x/${id}`,
  mainPath: `/x/${id}/main.mjs`,
  permissions: ['library.read'],
  name: null,
  description: null,
  author: null,
  platforms: [],
  minAppVersion: null,
  install: null,
  exerciseTypes: [
    {
      id: `${id}.a`,
      specSchema: {},
      answerSchema: {},
      element: 'x-a',
      rendererUrl: 'dolphy-ext://x/view.mjs',
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
  extensions: [extension('dolphy.sql', '1.0.1')],
  overridden: [
    {
      id: 'dolphy.sql',
      version: '1.0.0',
      origin: 'bundled',
      by: { origin: 'user', version: '1.0.1' },
    },
  ],
  diagnostics: [
    { extensionId: 'broken-dir', origin: 'user', message: 'bad manifest' },
  ],
};
const holder = createDiscoveryHolder(discovery);

describe('createExtensionRegistry', () => {
  const items = createExtensionRegistry(
    holder,
    createExtensionPolicy(holder),
  ).list();

  it('maps loaded extensions with their exercise types', () => {
    expect(items).toContainEqual({
      id: 'dolphy.sql',
      version: '1.0.1',
      origin: 'user',
      state: 'loaded',
      contributes: { ...NONE, exerciseTypes: ['dolphy.sql.a'] },
      message: null,
      permissions: ['library.read'],
      isolation: 'isolated',
      toggleable: true,
      name: null,
      description: null,
      author: null,
      installed: null,
      removable: true,
      revoked: null,
    });
  });

  it('maps overridden copies with the overriding origin and version', () => {
    expect(items).toContainEqual({
      id: 'dolphy.sql',
      version: '1.0.0',
      origin: 'bundled',
      state: 'overridden',
      contributes: NONE,
      message: 'overridden by user 1.0.1',
      permissions: [],
      isolation: 'trusted',
      toggleable: false,
      name: null,
      description: null,
      author: null,
      installed: null,
      removable: false,
      revoked: null,
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
      name: null,
      description: null,
      author: null,
      installed: null,
      removable: true,
      revoked: null,
    });
  });

  it('returns copies', () => {
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    registry.list()[0]?.contributes.exerciseTypes.push('evil');
    expect(registry.list()[0]?.contributes.exerciseTypes).toEqual([
      'dolphy.sql.a',
    ]);
  });
});

describe('createExtensionRegistry: политика', () => {
  const bundled: ResolvedExtension = {
    ...extension('dolphy.math'),
    origin: 'bundled',
    permissions: [],
    markdownRenderers: [
      {
        language: 'math',
        rendererUrl: 'dolphy-ext://dolphy.math/view.mjs',
      },
    ],
  };
  const user: ResolvedExtension = {
    ...extension('acme.u'),
    markdownRenderers: [
      {
        language: 'chart',
        rendererUrl: 'dolphy-ext://acme.u/view.mjs',
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
  const bothHolder = createDiscoveryHolder(both);

  it('отключённое расширение в списке со state disabled, без вкладов', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    policy.update({ disabled: ['acme.u'], trusted: [], checkUpdates: true });
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

  it('рендерер несёт origin и revision расширения: окно перевыводит блоки при правке', () => {
    const edited: ResolvedExtension = {
      ...user,
      origin: 'dev',
      revision: 'rev-2',
    };
    const holder = createDiscoveryHolder({
      extensions: [bundled, edited],
      overridden: [],
      diagnostics: [],
    });
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    expect(
      registry
        .contributions()
        .markdownRenderers.map(({ language, origin, revision }) => [
          language,
          origin,
          revision,
        ]),
    ).toEqual([
      ['math', 'bundled', ''],
      ['chart', 'dev', 'rev-2'],
    ]);
  });

  it('виды заданий несут origin, revision и isolated: окно видит правку и обновление элемента', () => {
    const edited: ResolvedExtension = {
      ...user,
      origin: 'dev',
      revision: 'rev-2',
    };
    const holder = createDiscoveryHolder({
      extensions: [bundled, edited],
      overridden: [],
      diagnostics: [],
    });
    const policy = createExtensionPolicy(holder);
    const registry = createExtensionRegistry(holder, policy);
    const types = () =>
      registry
        .contributions()
        .exerciseTypes.map(({ type, origin, revision, isolated }) => [
          type,
          origin,
          revision,
          isolated,
        ]);
    expect(types()).toEqual([
      ['dolphy.math.a', 'bundled', '', false],
      ['acme.u.a', 'dev', 'rev-2', true],
    ]);
    policy.update({ disabled: ['acme.u'], trusted: [], checkUpdates: true });
    expect(types()).toEqual([['dolphy.math.a', 'bundled', '', false]]);
  });

  it('isolation и isolated: поставка — доверена, доверенное пользователем — тоже', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
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
      ['dolphy.math', 'trusted', false],
      ['acme.u', 'isolated', true],
    ]);
    policy.update({
      disabled: [],
      trusted: ['acme.u', 'dolphy.math'],
      checkUpdates: true,
    });
    expect(flags()).toEqual({ math: false, chart: false });
    expect(registry.list().map(({ isolation }) => isolation)).toEqual([
      'trusted',
      'trusted',
    ]);
  });
});
