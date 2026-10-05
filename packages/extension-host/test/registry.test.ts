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
  icon: null,
  tags: [],
  install: null,
  messages: {},
  warnings: [],
  exerciseTypes: [
    {
      id: `${id}.a`,
      title: null,
      specSchema: {},
      answerSchema: {},
      element: 'x-a',
      rendererUrl: 'dolphy-ext://x/view.mjs',
    },
  ],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  widgets: [],
  panels: [],
  importers: [],
  exporters: [],
});

const NONE = {
  exerciseTypes: [],
  themes: [],
  markdownRenderers: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  panels: [],
  widgets: [],
  importers: [],
  exporters: [],
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
    {
      extensionId: 'broken-dir',
      origin: 'user',
      diagnostic: {
        code: 'manifest-invalid',
        data: { issues: ['bad manifest'] },
      },
    },
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
      diagnostics: [],
      permissions: ['library.read'],
      isolation: 'isolated',
      toggleable: true,
      name: null,
      description: null,
      author: null,
      installed: null,
      icon: null,
      titles: {},
      messages: {},
      tags: [],
      removable: true,
      revoked: null,
      deprecated: null,
    });
  });

  it('maps overridden copies with the overriding origin and version', () => {
    expect(items).toContainEqual({
      id: 'dolphy.sql',
      version: '1.0.0',
      origin: 'bundled',
      state: 'overridden',
      contributes: NONE,
      diagnostics: [
        { code: 'overridden-by', data: { origin: 'user', version: '1.0.1' } },
      ],
      permissions: [],
      isolation: 'trusted',
      toggleable: false,
      name: null,
      description: null,
      author: null,
      installed: null,
      icon: null,
      titles: {},
      messages: {},
      tags: [],
      removable: false,
      revoked: null,
      deprecated: null,
    });
  });

  it('maps diagnostics to invalid entries without a version', () => {
    expect(items).toContainEqual({
      id: 'broken-dir',
      version: null,
      origin: 'user',
      state: 'invalid',
      contributes: NONE,
      diagnostics: [
        { code: 'manifest-invalid', data: { issues: ['bad manifest'] } },
      ],
      permissions: [],
      isolation: 'isolated',
      toggleable: false,
      name: null,
      description: null,
      author: null,
      installed: null,
      icon: null,
      titles: {},
      messages: {},
      tags: [],
      removable: true,
      revoked: null,
      deprecated: null,
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
        title: null,
        rendererUrl: 'dolphy-ext://dolphy.math/view.mjs',
      },
    ],
  };
  const user: ResolvedExtension = {
    ...extension('acme.u'),
    markdownRenderers: [
      {
        language: 'chart',
        title: null,
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
    policy.update({
      disabled: ['acme.u'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    const item = registry.list().find(({ id }) => id === 'acme.u');
    expect(item).toMatchObject({
      state: 'disabled',
      diagnostics: [],
      toggleable: true,
      contributes: { themes: ['acme.u.night'], markdownRenderers: ['chart'] },
    });
    const { themes, markdownRenderers } = registry.contributions();
    expect(themes).toEqual([]);
    expect(markdownRenderers.map(({ language }) => language)).toEqual(['math']);
  });

  it('безопасный режим: расширение не из поставки disabled с диагностикой safe-mode и без вкладов, поставка загружена', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    policy.update({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: true,
      notificationsOff: [],
      catalogUrl: null,
    });
    const items = registry.list();
    expect(items.find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [{ code: 'safe-mode', data: {} }],
    });
    expect(items.find(({ id }) => id === 'dolphy.math')).toMatchObject({
      state: 'loaded',
      diagnostics: [],
    });
    const { themes, markdownRenderers } = registry.contributions();
    expect(themes).toEqual([]);
    expect(markdownRenderers.map(({ language }) => language)).toEqual(['math']);
  });

  it('безопасный режим: расширение, отключённое пользователем, всё равно несёт safe-mode; после выхода из режима диагностика исчезает', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    const settings = (safeMode: boolean) => ({
      disabled: ['acme.u'],
      trusted: [],
      checkUpdates: true,
      safeMode,
      notificationsOff: [],
      catalogUrl: null,
    });
    policy.update(settings(true));
    expect(registry.list().find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [{ code: 'safe-mode', data: {} }],
    });
    policy.update(settings(false));
    expect(registry.list().find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [],
    });
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
    policy.update({
      disabled: ['acme.u'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
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
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    expect(flags()).toEqual({ math: false, chart: false });
    expect(registry.list().map(({ isolation }) => isolation)).toEqual([
      'trusted',
      'trusted',
    ]);
  });
});

describe('createExtensionRegistry: titles and tags', () => {
  const titled: ResolvedExtension = {
    ...extension('acme.titled'),
    tags: ['theme', 'interface'],
    themes: [
      {
        id: 'acme.titled.night',
        label: 'Night',
        dark: true,
        colors: { background: '#000000' },
        variables: {},
      },
    ],
    exerciseTypes: [
      {
        id: 'acme.titled',
        title: 'Titled quiz',
        element: 'acme-titled-answer',
      },
      {
        id: 'acme.titled.bare',
        title: null,
        element: 'acme-bare-answer',
      },
    ],
    markdownRenderers: [
      { language: 'chart', title: 'Charts', rendererUrl: 'x' },
      { language: 'plain', title: null, rendererUrl: 'x' },
    ],
    gradePolicies: [{ id: 'acme.titled.strict', label: 'Strict' }],
    settings: [
      {
        type: 'boolean',
        id: 'acme.titled.flag',
        label: 'Flag',
        default: false,
      },
    ],
    commands: [
      {
        id: 'acme.titled.go',
        title: 'Go',
        description: null,
        category: null,
        keybinding: null,
        keybindings: [],
        palette: true,
      },
    ],
    panels: [{ id: 'acme.titled.main', title: 'Main', module: 'panel.mjs' }],
  } as unknown as ResolvedExtension;
  const discovered = createDiscoveryHolder({
    extensions: [titled, extension('acme.plain')],
    overridden: [
      {
        id: 'acme.old',
        version: '1.0.0',
        origin: 'bundled',
        by: { origin: 'user', version: '1.0.0' },
      },
    ],
    diagnostics: [
      {
        extensionId: 'broken',
        origin: 'user',
        diagnostic: { code: 'manifest-invalid', data: { issues: ['bad'] } },
      },
    ],
  });
  const policy = createExtensionPolicy(discovered);
  const registry = createExtensionRegistry(discovered, policy);
  const rowOf = (id: string) => registry.list().find((item) => item.id === id);

  it('names every titled contribution by id (renderers by language, only those with a title) and keeps the explicit tags', () => {
    expect(rowOf('acme.titled')).toMatchObject({
      titles: {
        exerciseTypes: { 'acme.titled': 'Titled quiz' },
        markdownRenderers: { chart: 'Charts' },
        themes: { 'acme.titled.night': 'Night' },
        gradePolicies: { 'acme.titled.strict': 'Strict' },
        settings: { 'acme.titled.flag': 'Flag' },
        commands: { 'acme.titled.go': 'Go' },
        panels: { 'acme.titled.main': 'Main' },
      },
      tags: ['theme', 'interface'],
    });
  });

  it('leaves out points without titles', () => {
    expect(rowOf('acme.plain')).toMatchObject({ titles: {}, tags: [] });
  });

  it('keeps the titles and tags of a disabled extension', () => {
    policy.update({
      disabled: ['acme.titled'],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
    expect(rowOf('acme.titled')).toMatchObject({
      state: 'disabled',
      titles: { themes: { 'acme.titled.night': 'Night' } },
      tags: ['theme', 'interface'],
    });
    policy.update({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
    });
  });

  it('is empty for overridden and invalid rows', () => {
    expect(rowOf('acme.old')).toMatchObject({
      state: 'overridden',
      titles: {},
      messages: {},
      tags: [],
    });
    expect(rowOf('broken')).toMatchObject({
      state: 'invalid',
      titles: {},
      messages: {},
      tags: [],
    });
  });

  it('returns copies of titles and tags', () => {
    const row = rowOf('acme.titled');
    row?.tags.push('developer');
    delete row?.titles.themes;
    expect(rowOf('acme.titled')).toMatchObject({
      tags: ['theme', 'interface'],
      titles: { themes: { 'acme.titled.night': 'Night' } },
    });
  });
});
