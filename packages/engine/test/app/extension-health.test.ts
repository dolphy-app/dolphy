import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  createFakeClock,
  createFakeExtensionCommands,
  createFakeExtensionHostControl,
  createFakeExtensionRegistry,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { createExtensionHealth } from '../../src/app/extension-health.ts';
import { ExtensionCommandError } from '../../src/ports/extension-commands.ts';
import type { ExtensionCommandErrorCause } from '../../src/ports/extension-commands.ts';
import { createTestEngine } from '../helpers/engine.ts';

const ID = 'acme.cmd';

const info = (id: string): ExtensionInfoDto => ({
  id,
  version: '1.0.0',
  origin: 'user',
  state: 'loaded',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [`${id}.run`],
    widgets: [],
    panels: [],
  },
  diagnostics: [],
  permissions: [],
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

const ZERO = {
  failures: 0,
  lastFailure: null,
  lastActivationMs: null,
  suppressedUntil: null,
};

describe('createExtensionHealth', () => {
  it('до событий у расширения нули; сбой растит счётчик и помнит последнюю причину со временем', () => {
    const clock = createFakeClock();
    const health = createExtensionHealth(clock);
    expect(health.get(ID)).toEqual({ id: ID, ...ZERO });

    health.recordFailure(ID, 'handler-failed', 'first');
    clock.advance(5000);
    health.recordFailure(ID, 'timeout', 'second');

    expect(health.get(ID)).toEqual({
      id: ID,
      failures: 2,
      lastFailure: { at: clock.now(), reason: 'timeout', message: 'second' },
      lastActivationMs: null,
      suppressedUntil: null,
    });
    expect(health.get('acme.other')).toEqual({ id: 'acme.other', ...ZERO });
  });

  it('длительность активации — последняя, округлённая', () => {
    const health = createExtensionHealth(createFakeClock());
    health.recordActivation(ID, 41.6);
    health.recordActivation(ID, 12.2);
    expect(health.get(ID).lastActivationMs).toBe(12);
  });

  it('приостановка видна до своего срока, потом исчезает; пока она действует, отказы не считаются сбоями', () => {
    const clock = createFakeClock();
    const health = createExtensionHealth(clock);
    health.recordFailure(ID, 'handler-failed', 'crash');
    const until = clock.now() + 60_000;
    health.recordSuppression(ID, until);

    expect(health.get(ID).suppressedUntil).toBe(until);
    health.recordFailure(
      ID,
      'activation-failed',
      'extension process keeps crashing',
    );
    expect(health.get(ID).failures).toBe(1);

    clock.advance(60_001);
    expect(health.get(ID).suppressedUntil).toBeNull();
    health.recordFailure(ID, 'handler-failed', 'again');
    expect(health.get(ID).failures).toBe(2);
  });

  it('forget очищает всю сводку расширения, остальные не трогает', () => {
    const health = createExtensionHealth(createFakeClock());
    health.recordFailure(ID, 'handler-failed', 'x');
    health.recordActivation(ID, 10);
    health.recordFailure('acme.other', 'handler-failed', 'y');

    health.forget(ID);

    expect(health.get(ID)).toEqual({ id: ID, ...ZERO });
    expect(health.get('acme.other').failures).toBe(1);
  });

  it('слушатели узнают об изменениях сводки и состояния хоста, но не о повторе того же состояния', () => {
    const health = createExtensionHealth(createFakeClock());
    let calls = 0;
    const off = health.subscribe(() => {
      calls += 1;
    });
    health.recordFailure(ID, 'handler-failed', 'x');
    health.setHostStatus('gave-up');
    health.setHostStatus('gave-up');
    health.forget('acme.unknown');
    expect(calls).toBe(2);
    expect(health.hostStatus()).toBe('gave-up');

    off();
    health.setHostStatus('running');
    expect(calls).toBe(2);
  });

  it('исключение слушателя не мешает остальным и учёту', () => {
    const health = createExtensionHealth(createFakeClock());
    let seen = 0;
    health.subscribe(() => {
      throw new Error('listener bug');
    });
    health.subscribe(() => {
      seen += 1;
    });
    health.recordFailure(ID, 'handler-failed', 'x');
    expect(seen).toBe(1);
    expect(health.get(ID).failures).toBe(1);
  });
});

describe('extensions.invokeCommand → здоровье', () => {
  const open = (cause?: ExtensionCommandErrorCause) => {
    const extensionCommands = createFakeExtensionCommands({
      [`${ID}/${ID}.run`]: () => {
        if (cause !== undefined) {
          throw new ExtensionCommandError(
            cause,
            ID,
            `${ID}.run`,
            `${cause} msg`,
          );
        }
        return { kind: 'none' };
      },
    });
    return createTestEngine({
      extensionCommands,
      extensionRegistry: createFakeExtensionRegistry([info(ID)], {
        exerciseTypes: [],
        themes: [],
        markdownRenderers: [],
        gradePolicies: [],
        settings: [],
        commands: [
          {
            id: `${ID}.run`,
            extensionId: ID,
            title: 'run',
            description: null,
            category: null,
            keybinding: null,
            keybindings: [],
            icon: 'puzzle',
            palette: true,
          },
        ],
        panels: [],
        widgets: [],
        messages: {},
      }),
    });
  };

  it.each(['handler-failed', 'timeout', 'invalid-result'] as const)(
    'отказ %s — сбой расширения: счётчик, причина, сообщение',
    async (cause) => {
      const { engine, clock } = await open(cause);
      await expect(
        engine.extensions.invokeCommand(ID, `${ID}.run`),
      ).rejects.toMatchObject({ code: 'EXTENSION_COMMAND_FAILED' });

      const { extensions } = await engine.extensions.diagnostics();
      expect(extensions).toEqual([
        {
          id: ID,
          failures: 1,
          lastFailure: {
            at: clock.now(),
            reason: cause,
            message: `${cause} msg`,
          },
          lastActivationMs: null,
          suppressedUntil: null,
        },
      ]);
    },
  );

  it.each(['host-down', 'replaced', 'unknown-command'] as const)(
    'отказ %s — состояние системы, а не сбой расширения',
    async (cause) => {
      const { engine } = await open(cause);
      await expect(
        engine.extensions.invokeCommand(ID, `${ID}.run`),
      ).rejects.toMatchObject({ code: 'EXTENSION_COMMAND_FAILED' });
      expect(
        (await engine.extensions.diagnostics()).extensions[0],
      ).toMatchObject({ failures: 0, lastFailure: null });
    },
  );

  it('успешная команда и отказ до обращения к расширению (аргументы, неизвестная команда) не считаются', async () => {
    const { engine } = await open();
    await engine.extensions.invokeCommand(ID, `${ID}.run`);
    await expect(
      engine.extensions.invokeCommand(ID, 'acme.cmd.missing'),
    ).rejects.toMatchObject({ code: 'EXTENSION_COMMAND_FAILED' });
    expect(
      (await engine.extensions.diagnostics()).extensions[0]?.failures,
    ).toBe(0);
  });
});

describe('extensions.diagnostics', () => {
  it('запись есть у каждого расширения списка (перекрытые — один раз), по id; хост и безопасный режим в ответе', async () => {
    const overridden: ExtensionInfoDto = {
      ...info('acme.b'),
      state: 'overridden',
    };
    const { engine } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([
        info('acme.b'),
        overridden,
        info('acme.a'),
      ]),
    });
    const report = await engine.extensions.diagnostics();
    expect(report.extensions.map(({ id }) => id)).toEqual(['acme.a', 'acme.b']);
    expect(report.host).toBe('running');
    expect(report.safeMode).toEqual({
      active: false,
      persisted: false,
      forcedBy: null,
    });
  });

  it('состояние хоста и сводка берутся из общего учёта; приостановка в прошлом не показывается', async () => {
    const { engine, deps, clock } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([info(ID)]),
    });
    deps.extensionHealth.setHostStatus('gave-up');
    deps.extensionHealth.recordSuppression(ID, clock.now() + 1000);
    let report = await engine.extensions.diagnostics();
    expect(report.host).toBe('gave-up');
    expect(report.extensions[0]?.suppressedUntil).toBe(clock.now() + 1000);

    clock.advance(2000);
    report = await engine.extensions.diagnostics();
    expect(report.extensions[0]?.suppressedUntil).toBeNull();
  });

  it('результат — копии: правка ответа не меняет учёт', async () => {
    const { engine, deps } = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([info(ID)]),
    });
    deps.extensionHealth.recordFailure(ID, 'handler-failed', 'x');
    const first = await engine.extensions.diagnostics();
    if (first.extensions[0]?.lastFailure) {
      first.extensions[0].lastFailure.message = 'changed';
    }
    const second = await engine.extensions.diagnostics();
    expect(second.extensions[0]?.lastFailure?.message).toBe('x');
  });

  it('изменение здоровья публикует extension-health-changed вне очереди команд', async () => {
    const { deps, events } = await createTestEngine();
    deps.extensionHealth.recordFailure(ID, 'handler-failed', 'x');
    deps.extensionHealth.setHostStatus('restarting');
    expect(
      events.filter(({ type }) => type === 'extension-health-changed'),
    ).toHaveLength(2);
  });
});

describe('extensions.restartHost', () => {
  it('просит оболочку перезапустить хост', async () => {
    const control = createFakeExtensionHostControl();
    const { engine } = await createTestEngine({
      extensionHostControl: control,
    });
    await engine.extensions.restartHost();
    expect(control.restarts()).toBe(1);
  });
});
