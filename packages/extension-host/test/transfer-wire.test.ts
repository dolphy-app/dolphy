import { describe, expect, it } from 'vitest';
import type {
  RunExporterRequest,
  RunImporterRequest,
} from '../src/protocol.ts';
import {
  CHUNK_BYTES,
  TransferWireError,
  chunksOf,
  createBodyReceiver,
  decodeFiles,
  encodeFiles,
  joinRequest,
  joinResult,
  splitRequest,
  splitResult,
} from '../src/transfer-wire.ts';

/** Прогоняет тело через части так, как это делают раннер и процесс. */
const viaChunks = (body: Uint8Array): Uint8Array => {
  const receiver = createBodyReceiver(body.length);
  let seq = 0;
  for (const data of chunksOf(body)) {
    expect(data.length).toBeLessThanOrEqual(256 * 1024);
    expect(receiver.accept(seq, data)).toBe(true);
    seq += 1;
  }
  expect(receiver.complete).toBe(true);
  return receiver.body();
};

describe('части тела', () => {
  it.each([
    0,
    1,
    CHUNK_BYTES - 1,
    CHUNK_BYTES,
    CHUNK_BYTES + 1,
    3 * CHUNK_BYTES,
  ])(
    'тело из %i байт доходит без потерь и частями не больше 256 КиБ',
    (size) => {
      const body = Uint8Array.from({ length: size }, (_, index) => index % 251);

      expect(viaChunks(body)).toEqual(body);
    },
  );

  it('пустое тело — одна пустая часть, иначе получатель не узнал бы о конце', () => {
    expect([...chunksOf(new Uint8Array())]).toEqual(['']);
  });

  it('тело, чьё начало не с начала буфера, не захватывает соседние байты', () => {
    const backing = Uint8Array.from({ length: 20 }, (_, index) => index);

    expect(viaChunks(backing.subarray(5, 9))).toEqual(
      Uint8Array.from([5, 6, 7, 8]),
    );
  });

  it('часть вне очереди, лишние байты, не base64 и неполная не последняя часть отвергаются', () => {
    const full = Uint8Array.from({ length: CHUNK_BYTES * 2 + 5 }, () => 1);
    const [first = '', second = ''] = [...chunksOf(full)];

    expect(createBodyReceiver(full.length).accept(1, second)).toBe(false);
    const receiver = createBodyReceiver(CHUNK_BYTES);
    expect(receiver.accept(0, first)).toBe(true);
    expect(receiver.accept(1, second)).toBe(false);
    expect(createBodyReceiver(10).accept(0, '!!!')).toBe(false);
    // 3 байта обещаны частью вместо полной: следующая часть смещение не определит
    expect(createBodyReceiver(CHUNK_BYTES + 3).accept(0, 'AAAA')).toBe(false);
  });

  it('пока не пришли все байты, тело не считается собранным', () => {
    const receiver = createBodyReceiver(CHUNK_BYTES + 3);
    const [first = ''] = [...chunksOf(new Uint8Array(CHUNK_BYTES + 3))];

    receiver.accept(0, first);

    expect(receiver.complete).toBe(false);
  });
});

describe('каталог файлов в кадрах', () => {
  it('сохраняет юникод, пустые файлы, переводы строк и путь __proto__ как обычный ключ', () => {
    const files: Record<string, string> = {
      'a/b.md': 'Привет, мир\r\n🙂',
      'empty.txt': '',
      'sp ace.txt': '\u0000\u007f',
    };
    Object.defineProperty(files, '__proto__', {
      value: 'own key',
      enumerable: true,
    });

    const decoded = decodeFiles(encodeFiles(files), 4);

    expect(Object.keys(decoded)).toEqual(Object.keys(files));
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toBe(
      'own key',
    );
    expect(decoded['a/b.md']).toBe('Привет, мир\r\n🙂');
  });

  it('обещанное число файлов должно совпасть: недостающий и лишний кадр — ошибка', () => {
    const bytes = encodeFiles({ a: '1', b: '2' });

    expect(() => decodeFiles(bytes, 3)).toThrow(TransferWireError);
    expect(() => decodeFiles(bytes, 1)).toThrow(TransferWireError);
  });

  it('оборванный кадр, повтор пути и не UTF-8 — ошибка', () => {
    const bytes = encodeFiles({ a: '12345' });

    expect(() => decodeFiles(bytes.subarray(0, bytes.length - 1), 1)).toThrow(
      TransferWireError,
    );
    expect(() => decodeFiles(new Uint8Array([0, 0]), 1)).toThrow(
      TransferWireError,
    );
    const twice = new Uint8Array([
      ...encodeFiles({ a: 'x' }),
      ...encodeFiles({ a: 'y' }),
    ]);
    expect(() => decodeFiles(twice, 2)).toThrow(/repeated/);
    const broken = encodeFiles({ a: 'x' });
    broken[broken.length - 1] = 0xff;
    expect(() => decodeFiles(broken, 1)).toThrow(/UTF-8/);
  });

  it('каталог в несколько МиБ проходит части', () => {
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `d/${index}.txt`,
        `${index}`.repeat(100_000),
      ]),
    );

    expect(decodeFiles(viaChunks(encodeFiles(files)), 40)).toEqual(files);
  });
});

describe('вызов и результат в голову и поток', () => {
  const importer = (
    body: { text: string } | { bytes: Uint8Array },
  ): RunImporterRequest => ({
    id: '7',
    method: 'runImporter',
    params: {
      extensionId: 'acme.csv',
      importerId: 'acme.csv.in',
      name: 'таблица.csv',
      isolated: true,
      ...body,
    },
  });

  it('импорт текстом: голова без тела, поток — UTF-8; вызов собирается заново, BOM остаётся', () => {
    const request = importer({ text: '\uFEFFимя;значение\n' });

    const split = splitRequest(request);

    expect(split?.head).toEqual({
      id: '7',
      method: 'runImporter',
      params: {
        extensionId: 'acme.csv',
        importerId: 'acme.csv.in',
        name: 'таблица.csv',
        isolated: true,
        input: 'text',
      },
    });
    expect(joinRequest(split!.head, viaChunks(split!.body))).toEqual(request);
  });

  it('импорт байтами собирается в Uint8Array с теми же байтами', () => {
    const bytes = Uint8Array.from(
      { length: CHUNK_BYTES + 9 },
      (_, i) => i % 256,
    );

    const split = splitRequest(importer({ bytes }))!;
    const joined = joinRequest(
      split.head,
      viaChunks(split.body),
    ) as RunImporterRequest;

    expect('bytes' in joined.params && joined.params.bytes).toEqual(bytes);
    expect('bytes' in joined.params && joined.params.bytes).toBeInstanceOf(
      Uint8Array,
    );
  });

  it('экспорт курса несёт файлы потоком, а id и название — в голове; экспорт прогресса потока не имеет', () => {
    const request: RunExporterRequest = {
      id: '8',
      method: 'runExporter',
      params: {
        extensionId: 'acme.csv',
        exporterId: 'acme.csv.out',
        isolated: true,
        input: {
          scope: 'course',
          courseId: 'c1',
          title: 'Курс',
          files: { 'course.yaml': 'id: c1', 'a/b.md': 'text' },
        },
      },
    };

    const split = splitRequest(request)!;

    expect(JSON.stringify(split.head)).not.toContain('id: c1');
    expect(joinRequest(split.head, viaChunks(split.body))).toEqual(request);
    expect(
      splitRequest({
        ...request,
        params: { ...request.params, input: { scope: 'progress' } },
      }),
    ).toBeNull();
  });

  it('результат: каталог, текст и байты проходят голову и поток', () => {
    const files = splitResult('runImporter', { files: { 'a.md': 'я' } });
    expect(joinResult(files.head, viaChunks(files.body))).toEqual({
      files: { 'a.md': 'я' },
    });

    const text = splitResult('runExporter', { filename: 'o.csv', text: 'ё' });
    expect(joinResult(text.head, viaChunks(text.body))).toEqual({
      filename: 'o.csv',
      text: 'ё',
    });

    const bytes = splitResult('runExporter', {
      filename: 'o.bin',
      bytes: Uint8Array.from([0, 255, 1]),
    });
    expect(joinResult(bytes.head, viaChunks(bytes.body))).toEqual({
      filename: 'o.bin',
      bytes: Uint8Array.from([0, 255, 1]),
    });
  });
});
