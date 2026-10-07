import { describe, expect, it } from 'vitest';
import { messageOf, registrarOf, run } from './registrar-harness.ts';

const ID = 'acme.csv';

const importer = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.in`,
  title: 'CSV',
  accept: ['.csv'],
  input: 'text',
  run,
  ...patch,
});

const exporter = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.out`,
  title: 'CSV',
  scope: 'course',
  run,
  ...patch,
});

const registerImporters = (...entries: Record<string, unknown>[]) => {
  const harness = registrarOf(ID);
  for (const entry of entries) harness.s.registerImporter(entry as never);
  return harness;
};

const registerExporters = (...entries: Record<string, unknown>[]) => {
  const harness = registrarOf(ID);
  for (const entry of entries) harness.s.registerExporter(entry as never);
  return harness;
};

describe('registerImporter', () => {
  it('записи нормализуются; обработчик остаётся в хосте', () => {
    const accept = ['.tsv', '.txt'];
    const { registrar } = registerImporters(
      importer(),
      importer({
        id: `${ID}.b`,
        title: { en: 'Tab', ru: 'Таб' },
        accept,
        input: 'bytes',
      }),
    );
    accept.push('.late');

    expect(registrar.snapshot().importers).toEqual([
      { id: `${ID}.in`, title: 'CSV', accept: ['.csv'], input: 'text' },
      {
        id: `${ID}.b`,
        title: { en: 'Tab', ru: 'Таб' },
        accept: ['.tsv', '.txt'],
        input: 'bytes',
      },
    ]);
    expect(registrar.handlers.importers.get(`${ID}.in`)?.handler).toBe(run);
  });

  it.each([
    [
      'id вне пространства расширения',
      importer({ id: 'other.in' }),
      "id must be 'acme.csv'",
    ],
    ['пустое название', importer({ title: '' }), 'title'],
    ['название 61 знак', importer({ title: 'x'.repeat(61) }), 'title'],
    ['нет accept', importer({ accept: undefined }), 'accept'],
    ['пустой accept', importer({ accept: [] }), 'accept'],
    [
      '9 расширений в accept',
      importer({
        accept: Array.from({ length: 9 }, (_value, index) => `.e${index}`),
      }),
      'accept',
    ],
    [
      'верхний регистр',
      importer({ accept: ['.CSV'] }),
      'lower-case file extension',
    ],
    ['без точки', importer({ accept: ['csv'] }), 'lower-case file extension'],
    [
      'путь вместо расширения',
      importer({ accept: ['../x'] }),
      'lower-case file extension',
    ],
    ['звёздочка', importer({ accept: ['.*'] }), 'lower-case file extension'],
    [
      'повтор в accept',
      importer({ accept: ['.a', '.a'] }),
      "duplicate accept extension '.a'",
    ],
    ['нет input', importer({ input: undefined }), 'input'],
    ['неизвестный input', importer({ input: 'stream' }), 'input'],
    ['нет обработчика', importer({ run: undefined }), 'run'],
    ['лишний ключ', importer({ module: './x.mjs' }), 'module'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(() => registerImporters(entry))).toContain(fragment);
  });

  it('границы accept: 8 расширений проходят', () => {
    const eight = Array.from({ length: 8 }, (_value, index) => `.e${index}`);

    expect(() => registerImporters(importer({ accept: eight }))).not.toThrow();
  });

  it('повтор id и более 8 записей', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        importer({ id: `${ID}.i${index}` }),
      );

    expect(
      messageOf(() => registerImporters(importer(), importer())),
    ).toContain(`duplicate importer '${ID}.in'`);
    expect(() => registerImporters(...many(8))).not.toThrow();
    expect(messageOf(() => registerImporters(...many(9)))).toContain(
      'at most 8 importers',
    );
  });

  it('Disposable убирает импортёра из снимка и обработчиков', () => {
    const { registrar, s } = registerImporters();
    s.registerImporter(importer() as never).dispose();

    expect(registrar.snapshot().importers).toEqual([]);
    expect(registrar.handlers.importers.size).toBe(0);
  });
});

describe('registerExporter', () => {
  it('принимает course и progress', () => {
    const { registrar } = registerExporters(
      exporter(),
      exporter({ id: `${ID}.p`, scope: 'progress' }),
    );

    expect(registrar.snapshot().exporters).toEqual([
      { id: `${ID}.out`, title: 'CSV', scope: 'course' },
      { id: `${ID}.p`, title: 'CSV', scope: 'progress' },
    ]);
    expect(registrar.handlers.exporters.get(`${ID}.out`)?.handler).toBe(run);
  });

  it.each([
    [
      'id вне пространства расширения',
      exporter({ id: 'other.out' }),
      "id must be 'acme.csv'",
    ],
    ['пустое название', exporter({ title: '' }), 'title'],
    ['название 61 знак', exporter({ title: 'x'.repeat(61) }), 'title'],
    ['неизвестный scope', exporter({ scope: 'all' }), 'scope'],
    ['нет scope', exporter({ scope: undefined }), 'scope'],
    ['нет обработчика', exporter({ run: 'x' }), 'run'],
    ['лишний ключ', exporter({ accept: ['.csv'] }), 'accept'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(() => registerExporters(entry))).toContain(fragment);
  });

  it('повтор id и более 8 записей', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        exporter({ id: `${ID}.e${index}` }),
      );

    expect(
      messageOf(() => registerExporters(exporter(), exporter())),
    ).toContain(`duplicate exporter '${ID}.out'`);
    expect(() => registerExporters(...many(8))).not.toThrow();
    expect(messageOf(() => registerExporters(...many(9)))).toContain(
      'at most 8 exporters',
    );
  });

  it('Disposable убирает экспортёра; импортёр и экспортёр с одним id не конфликтуют', () => {
    const { registrar, s } = registerExporters(exporter());
    s.registerImporter(importer({ id: `${ID}.out` }) as never);
    s.registerExporter(exporter({ id: `${ID}.other` }) as never).dispose();

    expect(registrar.snapshot().exporters.map(({ id }) => id)).toEqual([
      `${ID}.out`,
    ]);
    expect(registrar.snapshot().importers.map(({ id }) => id)).toEqual([
      `${ID}.out`,
    ]);
  });
});
