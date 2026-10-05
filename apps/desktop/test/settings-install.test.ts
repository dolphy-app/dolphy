import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  ExtensionDocsDto,
  InstallResultDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { targetFromEntry } from '@/pages/settings/lib/catalog.ts';
import type { InstallTarget } from '@/pages/settings/lib/catalog.ts';
import { useInstall } from '@/pages/settings/model/install.ts';
import type { ExtensionInstall } from '@/pages/settings/model/install.ts';
import {
  FakeEngineError,
  catalogEntry,
  catalogVersion,
  flush,
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
  docsCalls: Array<{ id: string; version: string | undefined }>;
  calls: { id: string; version: string | undefined }[];
  removed: string[];
  uninstallOptions: Array<{ removeData?: boolean } | undefined>;
}

/** `outcomes` — что делает `install(id)`: ошибка или успех (по умолчанию). */
const setup = (
  outcomes: Record<string, Error> = {},
  setupOptions: {
    uninstallError?: Error;
    /** Что отвечает `docs(id)`; по умолчанию журнала нет. */
    docs?: (id: string) => Promise<ExtensionDocsDto>;
  } = {},
): Setup => {
  const docsCalls: Setup['docsCalls'] = [];
  const calls: Setup['calls'] = [];
  const removed: string[] = [];
  const uninstallOptions: Array<{ removeData?: boolean } | undefined> = [];
  const engine = {
    extensions: {
      docs: (id: string, options?: { version?: string }) => {
        docsCalls.push({ id, version: options?.version });
        return (
          setupOptions.docs?.(id) ??
          Promise.resolve({
            version: options?.version ?? '1.1.0',
            readme: null,
            changelog: null,
            truncated: false,
            source: 'catalog',
          } satisfies ExtensionDocsDto)
        );
      },
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
        };
      },
      uninstall: async (id: string, options?: { removeData?: boolean }) => {
        if (setupOptions.uninstallError) throw setupOptions.uninstallError;
        removed.push(id);
        uninstallOptions.push(options);
      },
    },
  } as unknown as LearningEngine;
  const install = effectScope().run(() => useInstall(engine))!;
  return { install, docsCalls, calls, removed, uninstallOptions };
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
  });

  it('обновление ставит ту же версию, что выбрана в диалоге', async () => {
    const { install, calls } = setup();
    install.review([target('acme.sunrise', '1.0.0')]);
    await install.confirm();
    expect(calls).toEqual([{ id: 'acme.sunrise', version: '1.1.0' }]);
    expect(install.items.value[0]?.status).toBe('done');
  });

  it('отмена до подтверждения ничего не меняет; повторное подтверждение не ставит второй раз', async () => {
    const { install, calls } = setup();
    install.review([target('acme.sunrise')]);
    install.dismiss();
    expect(install.phase.value).toBe('idle');
    await install.confirm();
    expect(calls).toEqual([]);

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
  ])('ошибка %s → причина и retryable=%s', async (reason, retryable) => {
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
  });

  it('неизвестная ошибка → общий текст', async () => {
    const { install } = setup({ 'acme.sunrise': new Error('kaboom') });
    install.review([target('acme.sunrise')]);
    await install.confirm();
    expect(install.items.value[0]?.failure).toMatchObject({
      reason: 'unknown',
      message: 'kaboom',
    });
  });

  it('повтор ставит только не удавшееся', async () => {
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

describe('закрытие диалога', () => {
  it('после итога диалог закрывается; изменения уже действуют, ждать нечего', async () => {
    const { install } = setup();
    install.review([target('acme.sunrise')]);
    await install.confirm();
    install.dismiss();
    expect(install.phase.value).toBe('idle');
    expect(install.items.value).toEqual([]);
  });
});

describe('удаление', () => {
  it('успех удаляет расширение и освобождает кнопку', async () => {
    const { install, removed } = setup();
    expect(await install.remove('acme.sunrise')).toBe(true);
    expect(removed).toEqual(['acme.sunrise']);
    expect(install.removing.value).toBeNull();
  });

  it('данные расширения по умолчанию остаются; флажок удаляет их вместе с расширением', async () => {
    const { install, uninstallOptions } = setup();
    await install.remove('acme.sunrise');
    await install.remove('acme.sunrise', true);
    expect(uninstallOptions).toEqual([
      { removeData: false },
      { removeData: true },
    ]);
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
    expect(await install.remove('dolphy.sql')).toBe(false);
    expect(install.removeError.value).toBe('extension is not removable');
    expect(install.removing.value).toBeNull();
  });
});

const docsWith = (changelog: string | null) =>
  Promise.resolve({
    version: '1.2.0',
    readme: null,
    changelog,
    truncated: false,
    source: 'catalog',
  } satisfies ExtensionDocsDto);

const LOG = [
  '## [1.2.0] - 2026-10-02',
  '',
  '- два',
  '',
  '## 1.1.0',
  '',
  '- один',
  '',
  '## 1.0.0',
  '',
  '- ноль',
].join('\n');

describe('«Что нового» в диалоге обновления', () => {
  const update = () =>
    targetFromEntry(
      catalogEntry('acme.sunrise', { installedVersion: '1.0.0' }),
      catalogVersion('1.2.0'),
    );

  it('обновление запрашивает журнал целевой версии и берёт разделы новее установленной', async () => {
    const { install, docsCalls } = setup({}, { docs: () => docsWith(LOG) });
    install.review([update()]);
    expect(install.items.value[0]?.notes).toEqual({ state: 'loading' });
    await flush();
    expect(docsCalls).toEqual([{ id: 'acme.sunrise', version: '1.2.0' }]);
    const notes = install.items.value[0]?.notes;
    expect(notes?.state).toBe('ready');
    expect(
      notes?.state === 'ready' && notes.sections.map((s) => s.version),
    ).toEqual(['1.2.0', '1.1.0']);
  });

  it('новая установка журнал не запрашивает', async () => {
    const { install, docsCalls } = setup();
    install.review([target('acme.sunrise')]);
    await flush();
    expect(docsCalls).toEqual([]);
    expect(install.items.value[0]?.notes).toEqual({ state: 'none' });
  });

  it('журнала нет или в нём нет подходящих разделов — пустой список, установка работает', async () => {
    for (const changelog of [null, '## 0.9.0\n\n- старое']) {
      const { install, calls } = setup({}, { docs: () => docsWith(changelog) });
      install.review([update()]);
      await flush();
      expect(install.items.value[0]?.notes).toEqual({
        state: 'ready',
        sections: [],
      });
      await install.confirm();
      expect(calls).toEqual([{ id: 'acme.sunrise', version: '1.2.0' }]);
    }
  });

  it('сбой получения журнала не мешает обновлению', async () => {
    const { install, calls } = setup(
      {},
      {
        docs: () =>
          Promise.reject(
            new FakeEngineError('EXTENSION_INSTALL_FAILED', 'offline', {
              details: { reason: 'network' },
            }),
          ),
      },
    );
    install.review([update()]);
    await flush();
    expect(install.items.value[0]?.notes).toEqual({
      state: 'failed',
      message: 'offline',
    });
    await install.confirm();
    expect(calls).toHaveLength(1);
    expect(install.items.value[0]?.status).toBe('done');
  });

  it('ответ о журнале закрытого диалога не попадает в новый', async () => {
    let resolveFirst: (docs: ExtensionDocsDto) => void = () => {};
    const first = new Promise<ExtensionDocsDto>((resolve) => {
      resolveFirst = resolve;
    });
    let calls = 0;
    const { install } = setup(
      {},
      {
        docs: () => {
          calls += 1;
          return calls === 1 ? first : docsWith('## 1.2.0\n\n- новое');
        },
      },
    );
    install.review([update()]);
    install.dismiss();
    install.review([update()]);
    await flush();
    resolveFirst({
      version: '1.2.0',
      readme: null,
      changelog: '## 1.2.0\n\n- прежнее',
      truncated: false,
      source: 'catalog',
    });
    await flush();
    const notes = install.items.value[0]?.notes;
    expect(
      notes?.state === 'ready' && notes.sections.map((s) => s.body),
    ).toEqual(['- новое']);
  });
});
