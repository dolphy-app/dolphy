import { describe, expect, it } from 'vitest';
import { candidateOf, holderOf, resolvedOf } from './helpers.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import type { DiscoveryResult } from '../src/discover.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';

const NONE = {
  exerciseTypes: [],
  gradePolicies: [],
  settings: [],
  events: [],
  commands: [],
  schedules: [],
  importers: [],
  exporters: [],
};

const exerciseType = (id: string) => ({
  id,
  title: null,
  specSchema: {},
  answerSchema: {},
});

const settings = (disabled: string[], safeMode = false) => ({
  disabled,
  checkUpdates: true,
  safeMode,
  notificationsOff: [],
  catalogUrl: null,
  schedulesOff: [],
});

const discovery: DiscoveryResult = {
  ...discoveryOf([candidateOf('dolphy.sql', { version: '1.0.1' })]),
  overridden: [
    {
      id: 'dolphy.sql',
      version: '1.0.0',
      origin: 'bundled',
      by: { origin: 'user', version: '1.0.1' },
    },
  ],
};

const withBrokenDir = () => {
  const holder = createDiscoveryHolder(discovery);
  holder.applyRegistrations({
    registrations: {
      'dolphy.sql': {
        ok: true,
        registration: {
          ...NONE,
          exerciseTypes: [exerciseType('dolphy.sql.a')],
          rpcs: [],
          hooks: [],
        },
      },
    },
  });
  return holder;
};

describe('createExtensionRegistry', () => {
  const holder = withBrokenDir();
  const items = createExtensionRegistry(
    holder,
    createExtensionPolicy(holder),
  ).list();

  it('отображает загруженные расширения с идентификаторами их вкладов', () => {
    expect(items).toContainEqual({
      id: 'dolphy.sql',
      version: '1.0.1',
      origin: 'user',
      state: 'loaded',
      contributes: { ...NONE, exerciseTypes: ['dolphy.sql.a'] },
      diagnostics: [],
      toggleable: true,
      name: null,
      description: null,
      author: null,
      dependencies: [],
      installed: null,
      icon: null,
      tags: [],
      removable: true,
      revoked: null,
      deprecated: null,
    });
  });

  it('перекрытые копии несут origin и версию перекрывшего', () => {
    expect(items).toContainEqual({
      id: 'dolphy.sql',
      version: '1.0.0',
      origin: 'bundled',
      state: 'overridden',
      contributes: NONE,
      diagnostics: [
        { code: 'overridden-by', data: { origin: 'user', version: '1.0.1' } },
      ],
      toggleable: false,
      name: null,
      description: null,
      author: null,
      dependencies: [],
      installed: null,
      icon: null,
      tags: [],
      removable: false,
      revoked: null,
      deprecated: null,
    });
  });

  it('диагностики обнаружения дают invalid без версии', () => {
    const broken = createDiscoveryHolder({
      extensions: [],
      overridden: [],
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
    });
    const list = createExtensionRegistry(
      broken,
      createExtensionPolicy(broken),
    ).list();
    expect(list).toEqual([
      expect.objectContaining({
        id: 'broken-dir',
        version: null,
        origin: 'user',
        state: 'invalid',
        contributes: NONE,
        diagnostics: [
          { code: 'manifest-invalid', data: { issues: ['bad manifest'] } },
        ],
        toggleable: false,
        removable: true,
      }),
    ]);
  });

  it('ошибка регистрации показывается как invalid с load-failed и без вкладов', () => {
    const failing = createDiscoveryHolder(
      discoveryOf([
        candidateOf('acme.ok'),
        candidateOf('acme.fail', { version: '3.0.0' }),
      ]),
    );
    failing.applyRegistrations({
      registrations: {
        'acme.ok': {
          ok: true,
          registration: {
            ...NONE,
            exerciseTypes: [exerciseType('acme.ok.a')],
            rpcs: [],
            hooks: [],
          },
        },
        'acme.fail': { ok: false, error: 'boom' },
      },
    });
    const registry = createExtensionRegistry(
      failing,
      createExtensionPolicy(failing),
    );
    const failed = registry.list().find(({ id }) => id === 'acme.fail');
    expect(failed).toMatchObject({
      state: 'invalid',
      version: null,
      contributes: NONE,
      diagnostics: [{ code: 'load-failed', data: { reason: 'boom' } }],
    });
    expect(registry.list().find(({ id }) => id === 'acme.ok')?.state).toBe(
      'loaded',
    );
    expect(
      registry.contributions().exerciseTypes.map(({ type }) => type),
    ).toEqual(['acme.ok.a']);
  });

  it('возвращает копии', () => {
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
  const bundled = resolvedOf(
    'dolphy.math',
    {
      exerciseTypes: [exerciseType('dolphy.math.a')],
      gradePolicies: [{ id: 'dolphy.math.exact', label: 'Exact' }],
    },
    { origin: 'bundled', clientPath: '/x/dolphy.math/client.mjs' },
  );
  const user = resolvedOf(
    'acme.u',
    {
      exerciseTypes: [exerciseType('acme.u.a')],
      gradePolicies: [{ id: 'acme.u.strict', label: 'Strict' }],
    },
    { clientPath: '/x/acme.u/dist/client.mjs' },
  );
  const bothHolder = holderOf([bundled, user]);

  it('отключённое расширение в списке со state disabled, без вкладов', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    policy.update(settings(['acme.u']));
    expect(registry.list().find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [],
      toggleable: true,
      contributes: {
        exerciseTypes: ['acme.u.a'],
        gradePolicies: ['acme.u.strict'],
      },
    });
    const contributions = registry.contributions();
    expect(contributions.exerciseTypes.map(({ type }) => type)).toEqual([
      'dolphy.math.a',
    ]);
    expect(contributions.gradePolicies.map(({ id }) => id)).toEqual([
      'dolphy.math.exact',
    ]);
    expect(contributions.clients.map(({ extensionId }) => extensionId)).toEqual(
      ['dolphy.math'],
    );
  });

  it('безопасный режим: расширение не из поставки disabled с диагностикой safe-mode и без вкладов, поставка загружена', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    policy.update(settings([], true));
    const items = registry.list();
    expect(items.find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [{ code: 'safe-mode', data: {} }],
    });
    expect(items.find(({ id }) => id === 'dolphy.math')).toMatchObject({
      state: 'loaded',
      diagnostics: [],
    });
    expect(
      registry.contributions().exerciseTypes.map(({ type }) => type),
    ).toEqual(['dolphy.math.a']);
  });

  it('безопасный режим: расширение, отключённое пользователем, всё равно несёт safe-mode; после выхода из режима диагностика исчезает', () => {
    const policy = createExtensionPolicy(bothHolder);
    const registry = createExtensionRegistry(bothHolder, policy);
    policy.update(settings(['acme.u'], true));
    expect(registry.list().find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [{ code: 'safe-mode', data: {} }],
    });
    policy.update(settings(['acme.u'], false));
    expect(registry.list().find(({ id }) => id === 'acme.u')).toMatchObject({
      state: 'disabled',
      diagnostics: [],
    });
  });

  it('toggleable: расширение из поставки не переключается, пользовательское — да', () => {
    const registry = createExtensionRegistry(
      bothHolder,
      createExtensionPolicy(bothHolder),
    );
    expect(
      registry.list().map(({ id, toggleable }) => [id, toggleable]),
    ).toEqual([
      ['dolphy.math', false],
      ['acme.u', true],
    ]);
  });

  it('виды заданий несут расширение и заголовок и пропадают с отключением', () => {
    const titled = resolvedOf('acme.t', {
      exerciseTypes: [{ ...exerciseType('acme.t.a'), title: 'Квиз' }],
    });
    const holder = holderOf([bundled, titled]);
    const policy = createExtensionPolicy(holder);
    const registry = createExtensionRegistry(holder, policy);
    expect(registry.contributions().exerciseTypes).toEqual([
      { type: 'dolphy.math.a', extensionId: 'dolphy.math', title: null },
      { type: 'acme.t.a', extensionId: 'acme.t', title: 'Квиз' },
    ]);
    policy.update(settings(['acme.t']));
    expect(
      registry.contributions().exerciseTypes.map(({ type }) => type),
    ).toEqual(['dolphy.math.a']);
  });
});

describe('createExtensionRegistry: клиентская часть', () => {
  it('clients — только у включённых расширений с clientPath; url от каталога расширения, origin и revision из снимка', () => {
    const withClient = resolvedOf(
      'acme.x',
      {},
      {
        dir: '/x/acme.x',
        clientPath: '/x/acme.x/client.mjs',
        origin: 'dev',
        revision: 'rev-2',
      },
    );
    const nested = resolvedOf(
      'acme.nested',
      {},
      {
        dir: '/x/acme.nested',
        clientPath: '/x/acme.nested/dist/client.mjs',
      },
    );
    const serverOnly = resolvedOf('acme.server');
    const holder = holderOf([withClient, nested, serverOnly]);
    const policy = createExtensionPolicy(holder);
    const registry = createExtensionRegistry(holder, policy);
    expect(registry.contributions().clients).toEqual([
      {
        extensionId: 'acme.x',
        url: 'dolphy-ext://acme.x/client.mjs',
        origin: 'dev',
        revision: 'rev-2',
      },
      {
        extensionId: 'acme.nested',
        url: 'dolphy-ext://acme.nested/dist/client.mjs',
        origin: 'user',
        revision: '',
      },
    ]);
    policy.update(settings(['acme.x']));
    expect(
      registry.contributions().clients.map(({ extensionId }) => extensionId),
    ).toEqual(['acme.nested']);
  });

  it('расширение без main и client валидно и пусто', () => {
    const empty = resolvedOf('acme.empty', {}, { mainPath: null });
    const holder = holderOf([empty]);
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: 'acme.empty',
        state: 'loaded',
        contributes: NONE,
        diagnostics: [],
      }),
    ]);
    expect(registry.contributions().clients).toEqual([]);
  });
});
