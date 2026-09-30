import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { fileURLToPath } from 'node:url';
import { createLogger } from './helpers.ts';

const fixturesDir = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'lms-discover-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

interface Options {
  version?: string;
  type?: string;
  element?: string;
  manifestId?: string;
  specSchema?: string;
  withMain?: boolean;
  schemaBody?: string;
}

/** Создаёт каталог `<root>/<dirName>` с манифестом расширения. */
const makeExtension = async (
  root: string,
  dirName: string,
  o: Options = {},
): Promise<void> => {
  const dir = path.join(root, dirName);
  const id = o.manifestId ?? dirName;
  await mkdir(path.join(dir, 'schema'), { recursive: true });
  await writeFile(
    path.join(dir, 'extension.json'),
    JSON.stringify({
      id,
      version: o.version ?? '1.0.0',
      apiVersion: 1,
      main: './main.mjs',
      contributes: {
        exerciseTypes: [
          {
            id: o.type ?? id,
            specSchema: o.specSchema ?? './schema/spec.json',
            answerSchema: './schema/answer.json',
            element: o.element ?? `${id.replaceAll('.', '-')}-answer`,
            renderer: './view.mjs',
          },
        ],
      },
    }),
  );
  await writeFile(
    path.join(dir, 'schema/spec.json'),
    o.schemaBody ?? '{"type":"object"}',
  );
  await writeFile(path.join(dir, 'schema/answer.json'), '{"type":"string"}');
  if (o.withMain !== false) {
    await writeFile(path.join(dir, 'main.mjs'), 'export default {};');
    await writeFile(path.join(dir, 'view.mjs'), '');
  }
};

const rootDir = async (name: string): Promise<string> => {
  const dir = path.join(tmp, name);
  await mkdir(dir, { recursive: true });
  return dir;
};

describe('discoverExtensions', () => {
  it('user-корень переопределяет bundled с тем же id', async () => {
    const bundled = await rootDir('bundled');
    const user = await rootDir('user');
    await makeExtension(bundled, 'lms.choice', { version: '1.0.0' });
    await makeExtension(user, 'lms.choice', { version: '1.0.1' });
    const logger = createLogger();
    const { extensions, diagnostics, overridden } = await discoverExtensions({
      roots: [
        { dir: bundled, origin: 'bundled' },
        { dir: user, origin: 'user' },
      ],
      logger,
    });
    expect(diagnostics).toEqual([]);
    expect(overridden).toEqual([
      {
        id: 'lms.choice',
        version: '1.0.0',
        origin: 'bundled',
        by: { origin: 'user', version: '1.0.1' },
      },
    ]);
    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toMatchObject({
      id: 'lms.choice',
      version: '1.0.1',
      origin: 'user',
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0]![1]).toContain('1.0.0 → 1.0.1');
  });

  it('разбирает манифест: пути, схемы, URL renderer', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.one');
    const { extensions } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    const [extension] = extensions;
    expect(path.isAbsolute(extension!.mainPath)).toBe(true);
    expect(extension!.exerciseTypes[0]).toMatchObject({
      id: 'acme.one',
      specSchema: { type: 'object' },
      rendererUrl: 'lms-ext://acme.one/view.mjs',
    });
  });

  it('повторный id вида у разных расширений: первый выигрывает', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.a', { type: 'acme.a' });
    await makeExtension(root, 'acme.a.b', { type: 'acme.a' });
    const logger = createLogger();
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger,
    });
    expect(extensions.map((e) => e.id)).toEqual(['acme.a']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.extensionId).toBe('acme.a.b');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('повторный element у разных расширений: первый выигрывает', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.a', { element: 'acme-shared' });
    await makeExtension(root, 'acme.b', { element: 'acme-shared' });
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(extensions.map((e) => e.id)).toEqual(['acme.a']);
    expect(diagnostics[0]).toMatchObject({ extensionId: 'acme.b' });
  });

  it('имя каталога не совпало с id — расширение пропущено', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.dir', { manifestId: 'acme.other' });
    await makeExtension(root, 'acme.ok');
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(extensions.map((e) => e.id)).toEqual(['acme.ok']);
    expect(diagnostics[0]).toMatchObject({
      extensionId: 'acme.dir',
      origin: 'bundled',
    });
    expect(diagnostics[0]!.message).toContain('does not match');
  });

  it('путь схемы за пределами каталога — расширение пропущено', async () => {
    const root = await rootDir('r');
    // '..' отсекается уже разбором манифеста — расширение всё равно не грузится
    await makeExtension(root, 'acme.esc', { specSchema: './a/../../x.json' });
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(extensions).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it('схема не JSON или не компилируется — расширение пропущено', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.bad', { schemaBody: '{oops' });
    await makeExtension(root, 'acme.worse', {
      schemaBody: '{"type":"nonsense"}',
    });
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(extensions).toEqual([]);
    expect(diagnostics.map((d) => d.extensionId).sort()).toEqual([
      'acme.bad',
      'acme.worse',
    ]);
  });

  it('отсутствующий корень даёт пустой результат', async () => {
    const result = await discoverExtensions({
      roots: [{ dir: path.join(tmp, 'nope'), origin: 'user' }],
      logger: createLogger(),
    });
    expect(result).toEqual({
      extensions: [],
      diagnostics: [],
      overridden: [],
    });
  });

  it('подкаталог без extension.json пропускается молча', async () => {
    const root = await rootDir('r');
    await mkdir(path.join(root, 'stray'));
    const logger = createLogger();
    const result = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger,
    });
    expect(result.extensions).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('verifyFiles управляет проверкой main/renderer', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.nomain', { withMain: false });
    const strict = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(strict.extensions).toEqual([]);
    expect(strict.diagnostics[0]!.message).toContain('main');
    const lax = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
      verifyFiles: false,
    });
    expect(lax.extensions.map((e) => e.id)).toEqual(['acme.nomain']);
  });

  it('минимальный манифест: умолчания и встроенные схемы', async () => {
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: fixturesDir, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(diagnostics).toEqual([]);
    const minimal = extensions.find((e) => e.id === 'acme.minimal');
    expect(minimal?.mainPath).toBe(
      path.join(fixturesDir, 'acme.minimal', 'main.mjs'),
    );
    expect(minimal?.exerciseTypes[0]).toMatchObject({
      element: 'acme-minimal-answer',
      rendererUrl: 'lms-ext://acme.minimal/view.mjs',
      specSchema: { type: 'object' },
      answerSchema: { type: 'string' },
    });
    expect(Object.isFrozen(minimal?.exerciseTypes[0]?.specSchema)).toBe(true);
  });

  it('встроенная схема, не компилирующаяся в Ajv, — расширение пропущено', async () => {
    const root = await rootDir('r');
    const dir = path.join(root, 'acme.bad');
    await mkdir(dir);
    await writeFile(path.join(dir, 'main.mjs'), '');
    await writeFile(path.join(dir, 'view.mjs'), '');
    await writeFile(
      path.join(dir, 'extension.json'),
      JSON.stringify({
        id: 'acme.bad',
        version: '1.0.0',
        apiVersion: 1,
        contributes: {
          exerciseTypes: [
            {
              id: 'acme.bad',
              specSchema: { type: 'nonsense' },
              answerSchema: { type: 'string' },
            },
          ],
        },
      }),
    );
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(extensions).toEqual([]);
    expect(diagnostics[0]!.message).toContain('does not compile');
  });

  it('нет main.mjs по умолчанию — сообщение называет файл и умолчание', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.nomain', { withMain: false });
    const { diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(diagnostics[0]!.message).toBe(
      "main './main.mjs' (default) is not a file",
    );
  });
});

describe('inspectExtensionDir', () => {
  it('разбирает корректный каталог без проверки имени', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.ok');
    const result = await inspectExtensionDir(path.join(root, 'acme.ok'), {
      expectedId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extension.id).toBe('acme.ok');
    expect(result.extension.mainPath).toBe(
      path.join(root, 'acme.ok', 'main.mjs'),
    );
    expect(result.extension.exerciseTypes[0]!.rendererUrl).toBe(
      'lms-ext://acme.ok/view.mjs',
    );
  });

  it('невалидный манифест — сообщение парсера', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.bad');
    await writeFile(path.join(root, 'acme.bad', 'extension.json'), '{}');
    const result = await inspectExtensionDir(path.join(root, 'acme.bad'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('id');
  });

  it('нет main.mjs по умолчанию — сообщение называет файл', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.nomain', { withMain: false });
    const dir = path.join(root, 'acme.nomain');
    const strict = await inspectExtensionDir(dir);
    expect(strict).toEqual({
      ok: false,
      id: 'acme.nomain',
      message: "main './main.mjs' (default) is not a file",
    });
    expect((await inspectExtensionDir(dir, { verifyFiles: false })).ok).toBe(
      true,
    );
  });

  it('expectedId отличается от id манифеста — отказ', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.ok');
    const result = await inspectExtensionDir(path.join(root, 'acme.ok'), {
      expectedId: 'other',
    });
    expect(result.ok).toBe(false);
  });
});
