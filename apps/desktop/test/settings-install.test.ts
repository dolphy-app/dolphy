import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  InstallResultDto,
  LearningEngine,
} from '@spirula-app/engine-contract';
import { targetFromEntry } from '@/pages/settings/lib/catalog.ts';
import type { InstallTarget } from '@/pages/settings/lib/catalog.ts';
import { useInstall } from '@/pages/settings/model/install.ts';
import type { ExtensionInstall } from '@/pages/settings/model/install.ts';
import {
  FakeEngineError,
  catalogEntry,
  catalogVersion,
} from './support/extensions-fakes.ts';

const target = (
  id: string,
  installedVersion: string | null = null,
): InstallTarget =>
  targetFromEntry(
    catalogEntry(id, { installedVersion }),
    catalogVersion('1.1.0', { permissions: ['network'] }),
  );

const installFailed = (reason: string, retryable = false) =>
  new FakeEngineError('EXTENSION_INSTALL_FAILED', `failed: ${reason}`, {
    retryable,
    details: { reason },
  });

interface Setup {
  install: ExtensionInstall;
  calls: { id: string; version: string | undefined }[];
  applied: () => number;
  removed: string[];
}

/** `outcomes` — что делает `install(id)`: ошибка или успех (по умолчанию). */
const setup = (
  outcomes: Record<string, Error> = {},
  options: { applyError?: Error; uninstallError?: Error } = {},
): Setup => {
  const calls: Setup['calls'] = [];
  const removed: string[] = [];
  let applyCalls = 0;
  const engine = {
    extensions: {
      install: async (
        id: string,
        version?: string,
      ): Promise<InstallResultDto> => {
        calls.push({ id, version });
        const failure = outcomes[id];
        if (failure) throw failure;
        return {
          id,
          version: version ?? '1.1.0',
          previousVersion: null,
          restartRequired: true,
        };
      },
      uninstall: async (id: string) => {
        if (options.uninstallError) throw options.uninstallError;
        removed.push(id);
      },
    },
  } as unknown as LearningEngine;
  const install = effectScope().run(() =>
    useInstall(engine, {
      apply: async () => {
        applyCalls += 1;
        if (options.applyError) throw options.applyError;
      },
    }),
  )!;
  return { install, calls, applied: () => applyCalls, removed };
};

describe('установка одного расширения', () => {
  it('диалог открывается без запросов; установка идёт после подтверждения с точной версией', async () => {
    const { install, calls } = setup();
    install.review([target('acme.sunrise')]);
    expect(install.phase.value).toBe('confirm');
    expect(calls).toEqual([]);

    const running = install.confirm();
    expect(install.phase.value).toBe('running');
    expect(install.items.value[0]?.status).toBe('running');
    await running;

    expect(calls).toEqual([{ id: 'acme.sunrise', version: '1.1.0' }]);
    expect(install.phase.value).toBe('finished');
    expect(install.items.value[0]?.status).toBe('done');
    expect(install.succeeded.value).toBe(true);
    expect(install.pending.value.get('acme.sunrise')).toEqual({
      kind: 'installed',
      version: '1.1.0',
    });
    expect(install.needsApply.value).toBe(true);
  });

  it('обновление помечается как updated', async () => {
    const { install } = setup();
    install.review([target('acme.sunrise', '1.0.0')]);
    await install.confirm();
    expect(install.pending.value.get('acme.sunrise')?.kind).toBe('updated');
  });

  it('отмена до подтверждения ничего не меняет; повторное подтверждение не ставит второй раз', async () => {
    const { install, calls } = setup();
    install.review([target('acme.sunrise')]);
    install.dismiss();
    expect(install.phase.value).toBe('idle');
    await install.confirm();
    expect(calls).toEqual([]);
    expect(install.needsApply.value).toBe(false);

    install.review([target('acme.sunrise')]);
    await Promise.all([install.confirm(), install.confirm()]);
    expect(calls).toHaveLength(1);
  });

  it('пока идёт установка, диалог не закрывается и новый не открывается', async () => {
    const { install } = setup();
    install.review([target('acme.sunrise')]);
    const running = install.confirm();
    install.dismiss();
    install.review([target('acme.other')]);
    expect(install.phase.value).toBe('running');
    expect(install.items.value.map((item) => item.target.id)).toEqual([
      'acme.sunrise',
    ]);
    await running;
  });

  it.each([
    ['network', true],
    ['integrity', false],
    ['incompatible', false],
    ['limits', false],
    ['invalid', false],
    ['conflict', false],
  ])(
    'ошибка %s → причина, retryable=%s, ничего не ждёт перезагрузки',
    async (reason, retryable) => {
      const { install } = setup({
        'acme.sunrise': installFailed(reason, retryable),
      });
      install.review([target('acme.sunrise')]);
      await install.confirm();

      expect(install.phase.value).toBe('finished');
      expect(install.items.value[0]).toMatchObject({
        status: 'failed',
        failure: { reason, retryable },
      });
      expect(install.canRetry.value).toBe(retryable);
      expect(install.succeeded.value).toBe(false);
      expect(install.needsApply.value).toBe(false);
    },
  );

  it('неизвестная ошибка → общий текст', async () => {
    const { install } = setup({ 'acme.sunrise': new Error('kaboom') });
    install.review([target('acme.sunrise')]);
    await install.confirm();
    expect(install.items.value[0]?.failure).toMatchObject({
      reason: 'unknown',
      message: 'kaboom',
    });
  });

  it('повтор ставит только не удавшееся и после успеха ждёт перезагрузки', async () => {
    const outcomes: Record<string, Error> = {
      'acme.sunrise': installFailed('network', true),
    };
    const { install, calls } = setup(outcomes);
    install.review([target('acme.sunrise')]);
    await install.confirm();
    expect(install.canRetry.value).toBe(true);

    delete outcomes['acme.sunrise'];
    await install.retry();
    expect(calls).toHaveLength(2);
    expect(install.items.value[0]?.status).toBe('done');
    expect(install.items.value[0]?.failure).toBeNull();
    expect(install.needsApply.value).toBe(true);
  });
});

describe('обновление нескольких расширений', () => {
  it('идёт по очереди и продолжается после сбоя одного; итог по каждому', async () => {
    const { install, calls } = setup({ 'acme.b': installFailed('integrity') });
    install.review([
      target('acme.a', '1.0.0'),
      target('acme.b', '1.0.0'),
      target('acme.c', '1.0.0'),
    ]);
    await install.confirm();

    expect(calls.map((call) => call.id)).toEqual([
      'acme.a',
      'acme.b',
      'acme.c',
    ]);
    expect(install.items.value.map((item) => item.status)).toEqual([
      'done',
      'failed',
      'done',
    ]);
    expect(install.failed.value.map((item) => item.target.id)).toEqual([
      'acme.b',
    ]);
    expect([...install.pending.value.keys()]).toEqual(['acme.a', 'acme.c']);
  });

  it('повтор после частичного успеха не ставит готовое второй раз', async () => {
    const outcomes: Record<string, Error> = {
      'acme.b': installFailed('network', true),
    };
    const { install, calls } = setup(outcomes);
    install.review([target('acme.a', '1.0.0'), target('acme.b', '1.0.0')]);
    await install.confirm();
    delete outcomes['acme.b'];
    await install.retry();

    expect(calls.map((call) => call.id)).toEqual([
      'acme.a',
      'acme.b',
      'acme.b',
    ]);
  });
});

describe('применение и «Позже»', () => {
  it('«Позже» закрывает диалог, изменения остаются ждать перезагрузки', async () => {
    const { install } = setup();
    install.review([target('acme.sunrise')]);
    await install.confirm();
    install.dismiss();
    expect(install.phase.value).toBe('idle');
    expect(install.needsApply.value).toBe(true);
  });

  it('apply вызывает мост один раз, пока идёт', async () => {
    const { install, applied } = setup();
    install.review([target('acme.sunrise')]);
    await install.confirm();
    await Promise.all([install.apply(), install.apply()]);
    expect(applied()).toBe(1);
    expect(install.applying.value).toBe(true);
  });

  it('сбой apply показывает ошибку и разблокирует кнопку', async () => {
    const { install } = setup({}, { applyError: new Error('no window') });
    await install.apply();
    expect(install.applyError.value).toBe('no window');
    expect(install.applying.value).toBe(false);
  });
});

describe('удаление', () => {
  it('успех помечает расширение как удалённое до перезагрузки', async () => {
    const { install, removed } = setup();
    expect(await install.remove('acme.sunrise')).toBe(true);
    expect(removed).toEqual(['acme.sunrise']);
    expect(install.pending.value.get('acme.sunrise')).toEqual({
      kind: 'removed',
      version: null,
    });
    expect(install.removing.value).toBeNull();
  });

  it('отказ движка оставляет всё как было и показывает сообщение', async () => {
    const { install } = setup(
      {},
      {
        uninstallError: new FakeEngineError(
          'INVALID_ARGUMENT',
          'extension is not removable',
        ),
      },
    );
    expect(await install.remove('spirula.sql')).toBe(false);
    expect(install.removeError.value).toBe('extension is not removable');
    expect(install.needsApply.value).toBe(false);
    expect(install.removing.value).toBeNull();
  });
});
