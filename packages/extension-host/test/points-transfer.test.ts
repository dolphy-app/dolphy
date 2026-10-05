import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { discoverExtensions } from '../src/discover.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { extMessageSchema } from '../src/protocol.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger, holderOf } from './helpers.ts';

const ID = 'acme.csv';

const manifest = (
  contributes: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ id: ID, version: '1.0.0', apiVersion: 1, contributes, ...extra });

const importer = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.in`,
  title: 'CSV',
  accept: ['.csv'],
  ...patch,
});

const exporter = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.out`,
  title: 'CSV',
  scope: 'course',
  ...patch,
});

const messageOf = (raw: unknown): string => {
  const parsed = parseManifest(raw);
  if (parsed.ok) throw new Error('manifest was accepted');
  return formatDiagnostic(parsed.diagnostic);
};

describe('точка importers', () => {
  it('принимает запись; input по умолчанию text; нужен код: main подставляется', () => {
    const parsed = parseManifest(
      manifest({
        importers: [
          importer(),
          importer({ id: `${ID}.b`, accept: ['.tsv', '.txt'], input: 'bytes' }),
        ],
      }),
    );

    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBe('./main.mjs');
    expect(parsed.manifest.contributes.importers).toEqual([
      { id: `${ID}.in`, title: 'CSV', accept: ['.csv'], input: 'text' },
      {
        id: `${ID}.b`,
        title: 'CSV',
        accept: ['.tsv', '.txt'],
        input: 'bytes',
      },
    ]);
  });

  it.each([
    [
      'id вне пространства расширения',
      importer({ id: 'other.in' }),
      "id must be 'acme.csv'",
    ],
    ['пустое название', importer({ title: '' }), 'title'],
    ['название 61 знак', importer({ title: 'x'.repeat(61) }), 'title'],
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
    ['неизвестный input', importer({ input: 'stream' }), 'input'],
    ['лишний ключ', importer({ module: './x.mjs' }), 'module'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ importers: [entry] }))).toContain(fragment);
  });

  it('границы accept: 8 расширений проходят, повтор в одной записи — нет', () => {
    const eight = Array.from({ length: 8 }, (_value, index) => `.e${index}`);

    expect(
      parseManifest(manifest({ importers: [importer({ accept: eight })] })).ok,
    ).toBe(true);
    expect(
      messageOf(manifest({ importers: [importer({ accept: ['.a', '.a'] })] })),
    ).toContain("contributes.importers.0.accept.1: duplicate extension '.a'");
  });

  it('повтор id и более 8 записей', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        importer({ id: `${ID}.i${index}` }),
      );

    expect(
      messageOf(manifest({ importers: [importer(), importer()] })),
    ).toContain(`contributes.importers.1.id: duplicate id '${ID}.in'`);
    expect(parseManifest(manifest({ importers: many(8) })).ok).toBe(true);
    expect(messageOf(manifest({ importers: many(9) }))).toContain(
      'at most 8 importers',
    );
  });

  it('импортёр не требует разрешений', () => {
    expect(parseManifest(manifest({ importers: [importer()] })).ok).toBe(true);
  });
});

describe('точка exporters', () => {
  it('принимает course и progress (progress — с разрешением learning.stats)', () => {
    const parsed = parseManifest(
      manifest(
        {
          exporters: [
            exporter(),
            exporter({ id: `${ID}.p`, scope: 'progress' }),
          ],
        },
        { permissions: ['learning.stats'] },
      ),
    );

    if (!parsed.ok) throw new Error(formatDiagnostic(parsed.diagnostic));
    expect(parsed.manifest.main).toBe('./main.mjs');
    expect(parsed.manifest.contributes.exporters).toEqual([
      { id: `${ID}.out`, title: 'CSV', scope: 'course' },
      { id: `${ID}.p`, title: 'CSV', scope: 'progress' },
    ]);
  });

  it('экспортёр курса не требует разрешений', () => {
    expect(parseManifest(manifest({ exporters: [exporter()] })).ok).toBe(true);
  });

  it('progress без learning.stats — ошибка манифеста с путём к записи', () => {
    const raw = manifest({
      exporters: [exporter(), exporter({ id: `${ID}.p`, scope: 'progress' })],
    });

    expect(messageOf(raw)).toContain(
      "contributes.exporters.1.scope: scope 'progress' requires the 'learning.stats' permission",
    );
    expect(parseManifest({ ...raw, permissions: ['library.read'] }).ok).toBe(
      false,
    );
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
    ['лишний ключ', exporter({ accept: ['.csv'] }), 'accept'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(messageOf(manifest({ exporters: [entry] }))).toContain(fragment);
  });

  it('повтор id и более 8 записей', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        exporter({ id: `${ID}.e${index}` }),
      );

    expect(
      messageOf(manifest({ exporters: [exporter(), exporter()] })),
    ).toContain(`contributes.exporters.1.id: duplicate id '${ID}.out'`);
    expect(parseManifest(manifest({ exporters: many(8) })).ok).toBe(true);
    expect(messageOf(manifest({ exporters: many(9) }))).toContain(
      'at most 8 exporters',
    );
  });
});

describe('обнаружение и реестр импортёров и экспортёров', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-transfer-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const write = async (
    id: string,
    contributes: Record<string, unknown>,
    files: string[] = ['main.mjs'],
  ) => {
    await mkdir(path.join(root, id), { recursive: true });
    await writeFile(
      path.join(root, id, 'extension.json'),
      JSON.stringify({ id, version: '1.0.0', apiVersion: 1, contributes }),
    );
    for (const file of files) {
      await writeFile(path.join(root, id, file), 'export default {};');
    }
  };

  const discover = () =>
    discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
    });

  const registryOf = async (disabled: string[] = []) => {
    const holder = holderOf((await discover()).extensions);
    const policy = createExtensionPolicy(holder);
    policy.update({
      disabled,
      trusted: [],
      checkUpdates: true,
      safeMode: false,
    });
    return createExtensionRegistry(holder, policy);
  };

  it('вклады, названия и id в записи расширения', async () => {
    await write(ID, {
      importers: [importer({ input: 'bytes', accept: ['.csv', '.tsv'] })],
      exporters: [exporter()],
    });

    const registry = await registryOf();

    expect(registry.contributions().importers).toEqual([
      {
        id: `${ID}.in`,
        extensionId: ID,
        title: 'CSV',
        accept: ['.csv', '.tsv'],
        input: 'bytes',
      },
    ]);
    expect(registry.contributions().exporters).toEqual([
      { id: `${ID}.out`, extensionId: ID, title: 'CSV', scope: 'course' },
    ]);
    const [info] = registry.list();
    expect(info?.contributes).toMatchObject({
      importers: [`${ID}.in`],
      exporters: [`${ID}.out`],
    });
    expect(info?.titles).toMatchObject({
      importers: { [`${ID}.in`]: 'CSV' },
      exporters: { [`${ID}.out`]: 'CSV' },
    });
  });

  it('отключённое расширение не даёт ни импортёров, ни экспортёров', async () => {
    await write(ID, { importers: [importer()], exporters: [exporter()] });

    const contributions = (await registryOf([ID])).contributions();

    expect(contributions.importers).toEqual([]);
    expect(contributions.exporters).toEqual([]);
  });

  it('нет main у расширения с импортёром — расширение пропускается', async () => {
    await write(ID, { importers: [importer()] }, []);

    const found = await discover();

    expect(found.extensions).toEqual([]);
    expect(formatDiagnostic(found.diagnostics[0]!.diagnostic)).toContain(
      "main './main.mjs'",
    );
  });

  it('импортёр и экспортёр с одним id не конфликтуют (заявки importer:/exporter: раздельны)', async () => {
    await write(ID, {
      importers: [importer({ id: ID })],
      exporters: [exporter({ id: ID })],
    });

    const found = await discover();

    expect(found.diagnostics).toEqual([]);
    expect(found.extensions).toHaveLength(1);
  });

  it('набор расширений для хоста принимается только с массивами importers и exporters', async () => {
    await write(ID, { importers: [importer()], exporters: [exporter()] });
    const [extension] = (await discover()).extensions;
    const message = (value: unknown) => ({
      id: '1',
      method: 'replaceExtensions',
      params: { extensions: [value] },
    });
    const withoutImporters = { ...extension, importers: undefined };
    const withoutExporters = { ...extension, exporters: undefined };

    expect(
      extMessageSchema.safeParse(message({ ...extension, revision: 'r' }))
        .success,
    ).toBe(true);
    expect(
      extMessageSchema.safeParse(
        message({ ...withoutImporters, revision: 'r' }),
      ).success,
    ).toBe(false);
    expect(
      extMessageSchema.safeParse(
        message({ ...withoutExporters, revision: 'r' }),
      ).success,
    ).toBe(false);
  });
});
