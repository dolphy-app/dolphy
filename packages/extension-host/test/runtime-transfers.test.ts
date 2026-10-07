import { ExtensionTransferError } from '@dolphy-app/engine/ports';
import type {
  ExporterHandler,
  ImporterHandler,
} from '@dolphy-app/extension-api';
import { EXTENSION_TRANSFER_LIMITS } from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerModule } from '../src/runtime.ts';
import { candidateOf, deferred } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const ID = 'acme.csv';
const IN = `${ID}.in`;
const OUT = `${ID}.out`;
const MIB = 1024 * 1024;

let harness: Harness | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = null;
});

const open = async (
  ...args: Parameters<typeof createHarness>
): Promise<Harness> => {
  harness = await createHarness(...args);
  return harness;
};

interface Handlers {
  importers?: Record<string, ImporterHandler>;
  exporters?: Record<string, ExporterHandler>;
}

/** Вид и область вклада по его id: `-bin` принимает байты, `-progress` отдаёт прогресс. */
const moduleOf = ({ importers, exporters }: Handlers): ServerModule => ({
  server(s) {
    for (const [id, run] of Object.entries(importers ?? {})) {
      const bytes = id.endsWith('-bin');
      s.registerImporter({
        id,
        title: id,
        accept: [bytes ? '.bin' : '.csv'],
        input: bytes ? 'bytes' : 'text',
        run,
      });
    }
    for (const [id, run] of Object.entries(exporters ?? {})) {
      s.registerExporter({
        id,
        title: id,
        scope: id.endsWith('-progress') ? 'progress' : 'course',
        run,
      });
    }
  },
});

const start = (handlers: Handlers) =>
  open({
    candidates: [candidateOf(ID)],
    modules: { [ID]: moduleOf(handlers) },
  });

const importText = (h: Harness, text = 'a;b', id = IN) =>
  h.transfers.runImporter(ID, id, { name: 'sheet.csv', text });

const course = {
  scope: 'course',
  courseId: 'c1',
  title: 'Course',
  files: { 'course.yaml': 'id: c1' },
} as const;

describe('s.registerImporter', () => {
  it('обработчик получает имя и текст; результат — каталог файлов', async () => {
    const seen: unknown[] = [];
    const h = await start({
      importers: {
        [IN]: (input) => {
          seen.push(input);
          return { files: { 'course.yaml': 'id: c1', 'a/b.md': 'текст' } };
        },
      },
    });

    expect(await importText(h, 'x;y')).toEqual({
      files: { 'course.yaml': 'id: c1', 'a/b.md': 'текст' },
    });
    expect(seen).toEqual([{ name: 'sheet.csv', text: 'x;y' }]);
  });

  it('импортёр с input bytes получает Uint8Array с теми же байтами', async () => {
    let received: unknown;
    const h = await start({
      importers: {
        [`${IN}-bin`]: (input) => {
          received = input;
          return { files: {} };
        },
      },
    });

    await h.transfers.runImporter(ID, `${IN}-bin`, {
      name: 'a.bin',
      bytes: Uint8Array.from([0, 255, 7]),
    });

    expect(received).toEqual({
      name: 'a.bin',
      bytes: Uint8Array.from([0, 255, 7]),
    });
    expect((received as { bytes: unknown }).bytes).toBeInstanceOf(Uint8Array);
  });

  it('файл не той формы, которую объявил импортёр, не доходит до обработчика', async () => {
    const handler = vi.fn(() => ({ files: {} }));
    const h = await start({
      importers: { [IN]: handler, [`${IN}-bin`]: handler },
    });

    await expect(
      h.transfers.runImporter(ID, IN, {
        name: 'a.csv',
        bytes: Uint8Array.of(1),
      }),
    ).rejects.toMatchObject({
      name: 'ExtensionTransferError',
      cause: 'handler-failed',
      kind: 'import',
      message: `importer '${IN}' takes text input`,
    });
    await expect(
      h.transfers.runImporter(ID, `${IN}-bin`, { name: 'a.bin', text: 'x' }),
    ).rejects.toMatchObject({ cause: 'handler-failed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('файл больше 20 МиБ отвергается до вызова обработчика', async () => {
    const handler = vi.fn(() => ({ files: {} }));
    const h = await start({ importers: { [`${IN}-bin`]: handler } });

    await expect(
      h.transfers.runImporter(ID, `${IN}-bin`, {
        name: 'a.bin',
        bytes: new Uint8Array(EXTENSION_TRANSFER_LIMITS.inputBytes + 1),
      }),
    ).rejects.toMatchObject({ cause: 'handler-failed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('чужой и повторно зарегистрированный вклад — ошибка регистрации с названием', async () => {
    const errors: string[] = [];
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server(s) {
            s.registerImporter({
              id: IN,
              title: 'CSV',
              accept: ['.csv'],
              input: 'text',
              run: () => ({ files: {} }),
            });
            for (const register of [
              () =>
                s.registerImporter({
                  id: 'other.ghost',
                  title: 'x',
                  accept: ['.csv'],
                  input: 'text',
                  run: () => ({ files: {} }),
                }),
              () =>
                s.registerImporter({
                  id: IN,
                  title: 'x',
                  accept: ['.csv'],
                  input: 'text',
                  run: () => ({ files: {} }),
                }),
              () =>
                s.registerExporter({
                  id: OUT,
                  title: 'x',
                  scope: 'course',
                  run: () => ({ filename: 'a', text: '' }),
                }),
              () =>
                s.registerExporter({
                  id: OUT,
                  title: 'x',
                  scope: 'course',
                  run: () => ({ filename: 'a', text: '' }),
                }),
            ]) {
              try {
                register();
              } catch (error) {
                errors.push((error as Error).message);
              }
            }
          },
        },
      },
    });

    await importText(h);

    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("importer 'other.ghost'");
    expect(errors[1]).toContain(`importer '${IN}'`);
    expect(errors[1]).toContain('duplicate');
    expect(errors[2]).toContain(`exporter '${OUT}'`);
    expect(errors[2]).toContain('duplicate');
  });

  it('импортёр, которого нет, — unknown-importer', async () => {
    const h = await start({ importers: {} });

    await expect(importText(h, 'x', 'acme.csv.ghost')).rejects.toMatchObject({
      cause: 'unknown-importer',
      id: 'acme.csv.ghost',
    });
    await expect(importText(h)).rejects.toMatchObject({
      cause: 'unknown-importer',
    });
  });

  it('исключение и отказ промиса — handler-failed с текстом, соседний импортёр жив', async () => {
    const h = await start({
      importers: {
        [IN]: () => {
          throw new Error('sync boom');
        },
        [`${IN}-bin`]: () => Promise.reject(new Error('async boom')),
      },
    });

    await expect(importText(h)).rejects.toMatchObject({
      cause: 'handler-failed',
      message: 'sync boom',
    });
    await expect(
      h.transfers.runImporter(ID, `${IN}-bin`, {
        name: 'a.bin',
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ cause: 'handler-failed', message: 'async boom' });
  });

  it('обработчик, не уложившийся в 30 с, — timeout; хост не перезапускается', async () => {
    const restart = vi.fn();
    const h = await open({
      candidates: [candidateOf(ID)],
      restart,
      modules: {
        [ID]: moduleOf({
          importers: { [IN]: () => new Promise<never>(() => {}) },
        }),
      },
    });
    vi.useFakeTimers();

    const outcome = importText(h).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(29_900);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);

    expect(await outcome).toMatchObject({
      name: 'ExtensionTransferError',
      cause: 'timeout',
    });
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('результат импортёра', () => {
  const files = (count: number, content = 'x') =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`f/${index}.txt`, content]),
    );

  const run = async (result: unknown) => {
    const h = await start({ importers: { [IN]: () => result as never } });
    return importText(h);
  };

  it.each([
    ['5000 файлов', files(5000)],
    ['файл ровно 2 МиБ', { 'a.txt': 'x'.repeat(2 * MIB) }],
    ['10 файлов по 2 МиБ — ровно 20 МиБ', files(10, 'x'.repeat(2 * MIB))],
    ['вложенные каталоги и юникод', { 'уроки/один.md': '🙂', 'a/b/c.d': '' }],
    ['каталог без файлов', {}],
  ])('граница допустимого: %s', async (_name, result) => {
    const outcome = await run({ files: result });

    expect(Object.keys(outcome.files)).toEqual(Object.keys(result));
  });

  it.each([
    ['5001 файл', { files: files(5001) }, 'more than 5000 files'],
    [
      'файл 2 МиБ + 1',
      { files: { 'a.txt': 'x'.repeat(2 * MIB + 1) } },
      'longer than',
    ],
    [
      '11 файлов по 2 МиБ — больше 20 МиБ',
      { files: files(11, 'x'.repeat(2 * MIB)) },
      '20971520 bytes in all',
    ],
    [
      'двухбайтовые знаки считаются байтами',
      { files: { a: 'я'.repeat(MIB + 1) } },
      'longer than',
    ],
    ['путь ../x', { files: { '../x': '1' } }, 'starts with a dot'],
    ['путь .git/x', { files: { '.git/x': '1' } }, 'starts with a dot'],
    [
      'скрытый сегмент в середине',
      { files: { 'a/.hidden/b': '1' } },
      'starts with a dot',
    ],
    ['абсолютный путь', { files: { '/etc/x': '1' } }, 'empty segment'],
    ['пустой сегмент', { files: { 'a//b': '1' } }, 'empty segment'],
    ['каталог в конце пути', { files: { 'a/': '1' } }, 'empty segment'],
    ['пустой путь', { files: { '': '1' } }, 'path is empty'],
    ['обратная косая', { files: { 'a\\b': '1' } }, 'backslash'],
    ['управляющий знак в пути', { files: { 'a\u0000b': '1' } }, 'control'],
    [
      'путь длиннее 1024 байт',
      { files: { [`${'a'.repeat(1025)}`]: '1' } },
      'longer than 1024',
    ],
    [
      'A.md и a.md',
      { files: { 'A.md': '1', 'a.md': '2' } },
      'differ only in case',
    ],
    ['содержимое не строка', { files: { 'a.txt': 5 } }, 'must be a string'],
    [
      'bytes вместо текста',
      { files: { 'a.txt': Uint8Array.of(1) } },
      'must be a string',
    ],
    ['files — массив', { files: ['a'] }, 'files must be an object'],
    ['нет files', {}, 'files must be an object'],
    ['лишний ключ', { files: {}, extra: 1 }, "unexpected key 'extra'"],
    ['не объект', 'text', 'result must be an object'],
    ['undefined', undefined, 'result must be an object'],
  ])(
    'нарушение: %s — invalid-result, ничего не возвращается',
    async (_name, result, message) => {
      const failure = await run(result).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(ExtensionTransferError);
      expect(failure).toMatchObject({
        cause: 'invalid-result',
        kind: 'import',
        extensionId: ID,
        id: IN,
      });
      expect((failure as Error).message).toContain(message);
    },
  );
});

describe('s.registerExporter', () => {
  it('курс: обработчик получает снимок и возвращает текст или байты', async () => {
    const seen: unknown[] = [];
    const h = await start({
      exporters: {
        [OUT]: (input) => {
          seen.push(input);
          return { filename: 'course.csv', text: 'a,b' };
        },
        [`${OUT}-progress`]: () => ({
          filename: 'p.bin',
          bytes: Uint8Array.of(1, 2),
        }),
      },
    });

    expect(await h.transfers.runExporter(ID, OUT, course)).toEqual({
      filename: 'course.csv',
      text: 'a,b',
    });
    expect(seen).toEqual([course]);
    expect(
      await h.transfers.runExporter(ID, `${OUT}-progress`, {
        scope: 'progress',
      }),
    ).toEqual({ filename: 'p.bin', bytes: Uint8Array.of(1, 2) });
  });

  it('прогресс: данные обработчик берёт через s.stats', async () => {
    let calls = 0;
    const h = await open({
      candidates: [candidateOf(ID)],
      modules: {
        [ID]: {
          server(s) {
            s.registerExporter({
              id: `${OUT}-progress`,
              title: 'Progress',
              scope: 'progress',
              run: async (input) => {
                calls += 1;
                const streak = await s.stats.streak();
                return {
                  filename: 'p.txt',
                  text: `${input.scope} ${streak.current}/${streak.longest}`,
                };
              },
            });
          },
        },
      },
    });

    expect(
      await h.transfers.runExporter(ID, `${OUT}-progress`, {
        scope: 'progress',
      }),
    ).toEqual({ filename: 'p.txt', text: 'progress 3/7' });
    expect(calls).toBe(1);
  });

  it('снимок не той области, которую объявил экспортёр, не доходит до обработчика', async () => {
    const handler = vi.fn(() => ({ filename: 'a', text: '' }));
    const h = await start({
      exporters: { [OUT]: handler, [`${OUT}-progress`]: handler },
    });

    await expect(
      h.transfers.runExporter(ID, OUT, { scope: 'progress' }),
    ).rejects.toMatchObject({
      cause: 'handler-failed',
      kind: 'export',
      message: `exporter '${OUT}' takes the course scope`,
    });
    await expect(
      h.transfers.runExporter(ID, `${OUT}-progress`, course),
    ).rejects.toMatchObject({ cause: 'handler-failed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('снимок курса больше 20 МиБ не доходит до обработчика', async () => {
    const handler = vi.fn(() => ({ filename: 'a', text: '' }));
    const h = await start({ exporters: { [OUT]: handler } });
    const big = 'x'.repeat(2 * MIB);

    await expect(
      h.transfers.runExporter(ID, OUT, {
        ...course,
        files: Object.fromEntries(
          Array.from({ length: 11 }, (_, index) => [`${index}.txt`, big]),
        ),
      }),
    ).rejects.toMatchObject({ cause: 'handler-failed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unknown-exporter, сбой и таймаут обработчика', async () => {
    const h = await start({
      exporters: {
        [OUT]: () => {
          throw new Error('export boom');
        },
        [`${OUT}-progress`]: () => new Promise<never>(() => {}),
      },
    });
    vi.useFakeTimers();

    await expect(
      h.transfers.runExporter(ID, 'acme.csv.ghost', course),
    ).rejects.toMatchObject({ cause: 'unknown-exporter' });
    await expect(
      h.transfers.runExporter(ID, OUT, course),
    ).rejects.toMatchObject({
      cause: 'handler-failed',
      message: 'export boom',
    });
    const hanging = h.transfers
      .runExporter(ID, `${OUT}-progress`, { scope: 'progress' })
      .then(
        () => 'resolved',
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(30_100);
    expect(await hanging).toMatchObject({ cause: 'timeout', kind: 'export' });
  });
});

describe('результат экспортёра', () => {
  const run = async (result: unknown) => {
    const h = await start({ exporters: { [OUT]: () => result as never } });
    return h.transfers.runExporter(ID, OUT, course);
  };

  it.each([
    ['имя из 120 знаков', { filename: 'a'.repeat(120), text: '' }],
    [
      'имя с пробелами, точками и юникодом',
      { filename: 'Отчёт 1.2.csv', text: 'я' },
    ],
    ['пустые байты', { filename: 'a.bin', bytes: new Uint8Array() }],
    ['текст 20 МиБ', { filename: 'a.txt', text: 'x'.repeat(20 * MIB) }],
    ['байты 20 МиБ', { filename: 'a.bin', bytes: new Uint8Array(20 * MIB) }],
  ])('граница допустимого: %s', async (_name, result) => {
    const outcome = await run(result);

    // сравнение 20 МиБ поэлементно стоит минут и гигабайт: сверяются имя, вид и размер
    expect(outcome.filename).toBe(result.filename);
    if ('text' in result) {
      expect('text' in outcome && outcome.text.length).toBe(result.text.length);
    } else {
      expect('bytes' in outcome && outcome.bytes.length).toBe(
        result.bytes.length,
      );
    }
  });

  it.each([
    ['имя из 121 знака', { filename: 'a'.repeat(121), text: '' }, '1..120'],
    ['пустое имя', { filename: '', text: '' }, '1..120'],
    ['нет имени', { text: '' }, '1..120'],
    ['разделитель /', { filename: 'a/b.csv', text: '' }, 'path separators'],
    ['разделитель \\', { filename: 'a\\b.csv', text: '' }, 'path separators'],
    ['имя ..', { filename: '..', text: '' }, 'path separators'],
    ['имя .', { filename: '.', text: '' }, 'path separators'],
    ['управляющий знак', { filename: 'a\nb', text: '' }, 'path separators'],
    [
      'и text, и bytes',
      { filename: 'a', text: '', bytes: new Uint8Array() },
      'exactly one',
    ],
    ['ни text, ни bytes', { filename: 'a' }, 'exactly one'],
    ['text не строка', { filename: 'a', text: 5 }, 'text must be a string'],
    ['bytes — массив чисел', { filename: 'a', bytes: [1, 2] }, 'Uint8Array'],
    [
      'текст 20 МиБ + 1',
      { filename: 'a', text: 'x'.repeat(20 * MIB + 1) },
      'longer than',
    ],
    [
      'байты 20 МиБ + 1',
      { filename: 'a', bytes: new Uint8Array(20 * MIB + 1) },
      'longer than',
    ],
    [
      'лишний ключ',
      { filename: 'a', text: '', extra: 1 },
      "unexpected key 'extra'",
    ],
    ['не объект', 'file', 'result must be an object'],
  ])('нарушение: %s — invalid-result', async (_name, result, message) => {
    const failure = await run(result).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      name: 'ExtensionTransferError',
      cause: 'invalid-result',
      kind: 'export',
    });
    expect((failure as Error).message).toContain(message);
  });
});

describe('замена набора расширений', () => {
  it('идущий импорт доходит до результата старой сборки; новая сборка без импортёра отвечает unknown-importer', async () => {
    const release = deferred();
    const modules: Record<string, ServerModule> = {
      [ID]: moduleOf({
        importers: {
          [IN]: async () => {
            await release.promise;
            return { files: { 'v1.txt': '1' } };
          },
        },
      }),
    };
    const h = await open({ candidates: [candidateOf(ID)], modules });
    vi.useFakeTimers();
    const inFlight = importText(h);
    await vi.advanceTimersByTimeAsync(0);

    modules[ID] = moduleOf({});
    // замена ждёт идущий вызов: без `await`, иначе тест ждал бы его вечно
    const replaced = h.replace([candidateOf(ID, { revision: 'r2' })]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(importText(h)).rejects.toMatchObject({
      cause: 'unknown-importer',
    });
    release.resolve();

    expect(await inFlight).toEqual({ files: { 'v1.txt': '1' } });
    await replaced;
  });

  it('хост не подключён — host-down', async () => {
    const h = await start({ importers: { [IN]: () => ({ files: {} }) } });
    await h.channel.close();

    await expect(importText(h)).rejects.toMatchObject({ cause: 'host-down' });
    await expect(
      h.transfers.runExporter(ID, OUT, course),
    ).rejects.toMatchObject({ cause: 'host-down', kind: 'export' });
  });
});
