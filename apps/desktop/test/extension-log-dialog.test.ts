import { effectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_ENTRIES } from '@dolphy-app/engine-contract';
import type {
  ExtensionLogEntryDto,
  LearningEngine,
  ReadLogsOptions,
} from '@dolphy-app/engine-contract';
import {
  logQuery,
  useExtensionLog,
} from '@/pages/settings/model/extension-log.ts';
import {
  COPIED_MS,
  useDiagnosticsCopy,
} from '@/pages/settings/model/diagnostics-copy.ts';
import type { DiagnosticsCopyEnv } from '@/pages/settings/model/diagnostics-copy.ts';
import {
  diagnosticsDto,
  extensionInfo,
  flush,
} from './support/extensions-fakes.ts';

const entry = (
  at: number,
  override: Partial<ExtensionLogEntryDto> = {},
): ExtensionLogEntryDto => ({
  at,
  level: 'info',
  source: 'engine',
  message: `message ${at}`,
  extensionId: null,
  details: null,
  ...override,
});

interface Pending {
  options: ReadLogsOptions | undefined;
  resolve(entries: ExtensionLogEntryDto[]): void;
  reject(error: Error): void;
}

/** Каждый `readLogs` ждёт, пока тест его не завершит. */
const createFakeEngine = () => {
  const pending: Pending[] = [];
  const engine = {
    extensions: {
      readLogs: (options?: ReadLogsOptions) => {
        const { promise, resolve, reject } =
          Promise.withResolvers<ExtensionLogEntryDto[]>();
        pending.push({ options, resolve, reject });
        return promise;
      },
    },
  } as unknown as LearningEngine;
  return { engine, pending };
};

const mount = (engine: LearningEngine, extensionId?: string) =>
  effectScope().run(() => useExtensionLog(engine, extensionId))!;

describe('logQuery', () => {
  it('пустой id — без фильтра по расширению, предел — максимум', () => {
    expect(logQuery('', 'debug')).toEqual({
      minLevel: 'debug',
      limit: MAX_LOG_ENTRIES,
    });
    expect(logQuery('   ', 'warn')).toEqual({
      minLevel: 'warn',
      limit: MAX_LOG_ENTRIES,
    });
  });

  it('id обрезается по краям и уходит движку', () => {
    expect(logQuery(' acme.sql ', 'error')).toEqual({
      extensionId: 'acme.sql',
      minLevel: 'error',
      limit: MAX_LOG_ENTRIES,
    });
  });
});

describe('useExtensionLog', () => {
  it('открывается с предустановленным фильтром и запрашивает движок с ним', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine, 'acme.sql');
    expect(model.state.value).toBe('loading');
    expect(model.extensionId.value).toBe('acme.sql');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.options).toEqual({
      extensionId: 'acme.sql',
      minLevel: 'debug',
      limit: 500,
    });
  });

  it('без предустановки читает все записи', () => {
    const { engine, pending } = createFakeEngine();
    mount(engine);
    expect(pending[0]!.options).toEqual({ minLevel: 'debug', limit: 500 });
  });

  it('порядок движка (новые последними) сохраняется', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    const list = [entry(1), entry(5), entry(3), entry(9)];
    pending[0]!.resolve(list);
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(false);
    expect(model.entries.value.map(({ at }) => at)).toEqual([1, 5, 3, 9]);
  });

  it('пустой ответ — состояние loaded без записей', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]!.resolve([]);
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.entries.value).toEqual([]);
  });

  it('ошибка движка: failed и текст ошибки; повтор исправляет', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]!.reject(new Error('log dir unreadable'));
    await flush();
    expect(model.state.value).toBe('failed');
    expect(model.error.value).toBe('log dir unreadable');
    expect(model.entries.value).toEqual([]);

    void model.load();
    expect(model.state.value).toBe('loading');
    pending[1]!.resolve([entry(1)]);
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBeNull();
    expect(model.entries.value).toHaveLength(1);
  });

  it('«Обновить» перечитывает и не прячет показанные записи', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]!.resolve([entry(1)]);
    await flush();

    void model.load();
    expect(pending).toHaveLength(2);
    expect(model.busy.value).toBe(true);
    expect(model.state.value).toBe('loaded');
    expect(model.entries.value.map(({ at }) => at)).toEqual([1]);

    pending[1]!.resolve([entry(1), entry(2)]);
    await flush();
    expect(model.busy.value).toBe(false);
    expect(model.entries.value.map(({ at }) => at)).toEqual([1, 2]);
  });

  it('смена фильтра — новый запрос движку, старые записи спрятаны', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    pending[0]!.resolve([entry(1), entry(2, { extensionId: 'a' })]);
    await flush();

    void model.setExtensionId('a');
    expect(model.state.value).toBe('loading');
    expect(model.entries.value).toEqual([]);
    expect(pending[1]!.options).toEqual({
      extensionId: 'a',
      minLevel: 'debug',
      limit: 500,
    });
    pending[1]!.resolve([entry(2, { extensionId: 'a' })]);
    await flush();

    void model.setMinLevel('error');
    expect(pending[2]!.options).toEqual({
      extensionId: 'a',
      minLevel: 'error',
      limit: 500,
    });
    pending[2]!.resolve([]);
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.entries.value).toEqual([]);
  });

  it('то же значение фильтра не вызывает запрос', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine, 'a');
    pending[0]!.resolve([]);
    await flush();
    await model.setExtensionId('a');
    await model.setMinLevel('debug');
    expect(pending).toHaveLength(1);
  });

  it('гонка: медленный ранний ответ не затирает поздний', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    void model.setExtensionId('a');
    void model.setExtensionId('ab');
    expect(pending).toHaveLength(3);

    pending[2]!.resolve([entry(30, { extensionId: 'ab' })]);
    await flush();
    pending[0]!.resolve([entry(10)]);
    pending[1]!.resolve([entry(20, { extensionId: 'a' })]);
    await flush();

    expect(model.entries.value.map(({ at }) => at)).toEqual([30]);
    expect(model.state.value).toBe('loaded');
    expect(model.busy.value).toBe(false);
  });

  it('гонка: ошибка раннего запроса не заменяет успех позднего', async () => {
    const { engine, pending } = createFakeEngine();
    const model = mount(engine);
    void model.load();
    pending[1]!.resolve([entry(2)]);
    await flush();
    pending[0]!.reject(new Error('stale failure'));
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.error.value).toBeNull();
  });
});

describe('useDiagnosticsCopy', () => {
  const setup = (env: Partial<DiagnosticsCopyEnv> = {}) => {
    const written: string[] = [];
    const engine = {
      diagnostics: async () => ({
        contractVersion: 16,
        engineVersion: '1.0.0',
      }),
      extensions: {
        diagnostics: async () => diagnosticsDto(),
        list: async () => [extensionInfo('acme.sql')],
      },
    } as unknown as LearningEngine;
    const model = effectScope().run(() =>
      useDiagnosticsCopy(engine, {
        appInfo: async () => ({
          appVersion: '1.0.0',
          electron: '44',
          chrome: '140',
          node: '24',
          platform: 'darwin',
          arch: 'arm64',
        }),
        writeText: async (text) => {
          written.push(text);
        },
        ...env,
      }),
    )!;
    return { model, written };
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('кладёт отчёт в буфер и показывает «скопировано», затем возвращается', async () => {
    vi.useFakeTimers();
    const { model, written } = setup();
    await model.copy();
    expect(model.state.value).toBe('copied');
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('Contract version: 16');
    expect(written[0]).toContain('- acme.sql 1.0.0');
    vi.advanceTimersByTime(COPIED_MS);
    expect(model.state.value).toBe('idle');
  });

  it('отказ буфера обмена — failed с текстом ошибки', async () => {
    const { model } = setup({
      writeText: async () => {
        throw new Error('Document is not focused');
      },
    });
    await model.copy();
    expect(model.state.value).toBe('failed');
    expect(model.error.value).toBe('Document is not focused');
  });

  it('отказ движка при сборе — failed, буфер не тронут', async () => {
    const { model, written } = setup({
      appInfo: async () => {
        throw new Error('no app info');
      },
    });
    await model.copy();
    expect(model.state.value).toBe('failed');
    expect(written).toEqual([]);
  });
});
