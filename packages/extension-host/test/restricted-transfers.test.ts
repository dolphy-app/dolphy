import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import {
  createRestrictedRunner,
  defaultSpawn,
} from '../src/restricted-runner.ts';
import type { SpawnRestricted } from '../src/restricted-runner.ts';
import { createLogger } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/transfer-extensions', import.meta.url),
);
const entryPath = fileURLToPath(
  new URL('./fixtures/restricted-main.mjs', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Тест запускает дочерний процесс из исходников (см. restricted.test.ts)
const extraArgs = [
  `--allow-fs-read=${realpathSync(repoRoot)}`,
  '--disable-warning=ExperimentalWarning',
  ...((process.features as { typescript?: unknown }).typescript === false
    ? ['--experimental-strip-types']
    : []),
];
const spawnFromSources: SpawnRestricted = (spec) =>
  defaultSpawn({
    ...spec,
    args: [...spec.args.slice(0, -1), ...extraArgs, spec.args.at(-1) as string],
  });

const ID = 'acme.csv';
const id = (name: string) => `${ID}.${name}`;
const TEST_TIMEOUT = 60_000;
const MIB = 1024 * 1024;

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

const start = async (transferDeadlineMs?: number) => {
  const found = await discoverExtensions({
    roots: [{ dir: fixtures, origin: 'user' }],
    logger: createLogger(),
  });
  const extension = found.extensions.find(
    (item) => item.id === ID,
  ) as ResolvedExtension;
  const restart = vi.fn();
  // origin user и не доверено: изоляция включена
  harness = createHarness({
    extensions: [extension],
    restart,
    runners: {
      create: (item, engine) =>
        createRestrictedRunner({
          extension: item,
          entryPath,
          library: { readText: async () => '', stat: async () => null },
          engine,
          logger: createLogger(),
          spawn: spawnFromSources,
          ...(transferDeadlineMs !== undefined && { transferDeadlineMs }),
        }),
    },
  });
  return { h: harness, restart };
};

const importText = (h: Harness, name: string, text: string) =>
  h.transfers.runImporter(ID, id(name), { name: `${name}.txt`, text });

/** Текст не короче `length`, где знак зависит от позиции: перестановка частей не прошла бы незамеченной. */
const patterned = (length: number): string => {
  const chars = [...'абвгдежз🙂\n"\\\t0123456789'];
  const parts: string[] = [];
  let size = 0;
  for (let index = 0; size < length; index++) {
    const char = chars[(index * 7 + (index >> 3)) % chars.length] as string;
    parts.push(char);
    size += char.length;
  }
  return parts.join('');
};

describe('импорт и экспорт изолированного расширения в настоящем ограниченном процессе', () => {
  it(
    'текст в несколько частей доходит до обработчика и обратно без потерь; имя и юникод целы',
    async () => {
      const { h } = await start();
      const text = `\uFEFF${patterned(2 * MIB + 12_345)}`;

      const result = await importText(h, 'text', text);

      expect(result.files['name.txt']).toBe('text.txt');
      const body = Object.keys(result.files)
        .filter((path) => path.startsWith('body/'))
        .sort(
          (a, b) =>
            Number.parseInt(a.slice(5), 10) - Number.parseInt(b.slice(5), 10),
        )
        .map((path) => result.files[path])
        .join('');
      expect(body === text).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    'байты в несколько частей: обработчик получает Uint8Array с теми же байтами',
    async () => {
      const { h } = await start();
      const bytes = Uint8Array.from(
        { length: 1_000_003 },
        (_, index) => (index * 31 + 7) % 256,
      );
      const sum = bytes.reduce((total, byte) => (total + byte) % 1_000_003, 0);

      const result = await h.transfers.runImporter(ID, id('bytes'), {
        name: 'data.bin',
        bytes,
      });

      expect(JSON.parse(result.files['info.json'] as string)).toEqual({
        name: 'data.bin',
        isUint8Array: true,
        length: bytes.length,
        sum,
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'пустой файл проходит',
    async () => {
      const { h } = await start();

      const result = await importText(h, 'text', '');

      expect(result.files['body/0.txt']).toBe('');
    },
    TEST_TIMEOUT,
  );

  it(
    '5000 файлов и каталог в несколько МиБ проходят поток; 5001 — invalid-result',
    async () => {
      const { h } = await start();

      const many = await importText(
        h,
        'many',
        JSON.stringify({ count: 5000, size: 1000 }),
      );
      expect(Object.keys(many.files)).toHaveLength(5000);
      expect(many.files['f/4999.txt']).toBe('x'.repeat(1000));

      await expect(
        importText(h, 'many', JSON.stringify({ count: 5001, size: 1 })),
      ).rejects.toMatchObject({ cause: 'invalid-result', kind: 'import' });
    },
    TEST_TIMEOUT,
  );

  it(
    'результат вне правил (путь ../) отвергается в процессе; сбой обработчика — handler-failed; процесс остаётся жив',
    async () => {
      const { h, restart } = await start();
      const before = (await importText(h, 'pid', '')).files['pid.txt'];

      await expect(importText(h, 'bad', '')).rejects.toMatchObject({
        cause: 'invalid-result',
      });
      await expect(importText(h, 'fail', '')).rejects.toMatchObject({
        cause: 'handler-failed',
        message: 'importer boom',
      });

      expect((await importText(h, 'pid', '')).files['pid.txt']).toBe(before);
      expect(restart).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );

  it(
    'экспорт курса: файлы курса доходят потоком, результат — текст или байты',
    async () => {
      const { h } = await start();
      const files = {
        'course.yaml': 'id: c1\n',
        'урок/один.md': patterned(700_000),
        'empty.md': '',
      };

      const asText = await h.transfers.runExporter(ID, id('course'), {
        scope: 'course',
        courseId: 'c1',
        title: 'Курс 🙂',
        files,
      });
      const asBytes = await h.transfers.runExporter(ID, id('course-bytes'), {
        scope: 'course',
        courseId: 'c1',
        title: 't',
        files,
      });

      expect(asText).toMatchObject({ filename: 'course.json' });
      expect(JSON.parse((asText as { text: string }).text)).toEqual({
        courseId: 'c1',
        title: 'Курс 🙂',
        files,
      });
      expect(asBytes).toMatchObject({ filename: 'course.bin' });
      expect((asBytes as { bytes: Uint8Array }).bytes).toEqual(
        new TextEncoder().encode(Object.values(files).join('')),
      );
    },
    TEST_TIMEOUT,
  );

  it(
    'экспорт прогресса: обработчик берёт данные через ctx.stats процесса',
    async () => {
      const { h } = await start();

      expect(
        await h.transfers.runExporter(ID, id('progress'), {
          scope: 'progress',
        }),
      ).toEqual({ filename: 'progress.txt', text: 'streak 3' });
    },
    TEST_TIMEOUT,
  );

  it(
    'результат экспорта в несколько МиБ байтами доходит целиком; имя файла с разделителем — invalid-result',
    async () => {
      const { h } = await start();

      const huge = await h.transfers.runExporter(ID, id('huge'), {
        scope: 'progress',
      });
      expect('bytes' in huge && huge.bytes.length).toBe(5 * MIB + 7);
      expect('bytes' in huge && huge.bytes.every((byte) => byte === 7)).toBe(
        true,
      );

      await expect(
        h.transfers.runExporter(ID, id('bad-name'), { scope: 'progress' }),
      ).rejects.toMatchObject({ cause: 'invalid-result', kind: 'export' });
    },
    TEST_TIMEOUT,
  );

  it(
    'бесконечный цикл: раннер убивает процесс по сроку — timeout; хост не перезапускается, следующий вызов поднимает новый процесс',
    async () => {
      const { h, restart } = await start(2_500);
      const before = (await importText(h, 'pid', '')).files['pid.txt'];

      await expect(importText(h, 'spin', '')).rejects.toMatchObject({
        name: 'ExtensionTransferError',
        cause: 'timeout',
        kind: 'import',
      });

      const after = (await importText(h, 'pid', '')).files['pid.txt'];
      expect(after).not.toBe(before);
      expect(restart).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});
