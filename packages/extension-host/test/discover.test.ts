import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createDiscoveryHolder } from '../src/holder.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { fileURLToPath } from 'node:url';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

const fixturesDir = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'dolphy-discover-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

interface Options {
  version?: string;
  type?: string;
  markdown?: string;
  manifestId?: string;
  specSchema?: string;
  withMain?: boolean;
  schemaBody?: string;
  extra?: Record<string, unknown>;
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
      ...o.extra,
      contributes: {
        exerciseTypes: [
          {
            id: o.type ?? id,
            specSchema: o.specSchema ?? './schema/spec.json',
            answerSchema: './schema/answer.json',
            renderer: './view.mjs',
          },
        ],
        ...(o.markdown !== undefined && {
          markdownRenderers: [{ language: o.markdown, renderer: './view.mjs' }],
        }),
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
    await makeExtension(bundled, 'dolphy.choice', { version: '1.0.0' });
    await makeExtension(user, 'dolphy.choice', { version: '1.0.1' });
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
        id: 'dolphy.choice',
        version: '1.0.0',
        origin: 'bundled',
        by: { origin: 'user', version: '1.0.1' },
      },
    ]);
    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toMatchObject({
      id: 'dolphy.choice',
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
    expect(path.isAbsolute(extension!.mainPath ?? '')).toBe(true);
    expect(extension!.exerciseTypes[0]).toMatchObject({
      id: 'acme.one',
      specSchema: { type: 'object' },
      rendererUrl: 'dolphy-ext://acme.one/view.mjs',
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

  it('повторный язык markdown у разных расширений: первый выигрывает', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.a', { markdown: 'shared' });
    await makeExtension(root, 'acme.b', { markdown: 'shared' });
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
    expect(formatDiagnostic(diagnostics[0]!.diagnostic)).toContain(
      'does not match',
    );
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

  it('служебные каталоги установщика с точкой в имени не считаются расширениями', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.real');
    await makeExtension(path.join(root, '.staging'), 'acme.real-1a2b');
    await makeExtension(root, '.trash');
    await mkdir(path.join(root, '.catalog'));
    const logger = createLogger();
    const result = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger,
    });
    expect(result.extensions.map((e) => e.id)).toEqual(['acme.real']);
    expect(result.diagnostics).toEqual([]);
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
    expect(formatDiagnostic(strict.diagnostics[0]!.diagnostic)).toContain(
      'main',
    );
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
      rendererUrl: 'dolphy-ext://acme.minimal/view.mjs',
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
    expect(formatDiagnostic(diagnostics[0]!.diagnostic)).toContain(
      'does not compile',
    );
  });

  it('нет main.mjs по умолчанию — сообщение называет файл и умолчание', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.nomain', { withMain: false });
    const { diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'bundled' }],
      logger: createLogger(),
    });
    expect(formatDiagnostic(diagnostics[0]!.diagnostic)).toBe(
      "main './main.mjs' (default) is not a file",
    );
  });
});

describe('диагностики по кодам', () => {
  const codes = async (setup: (root: string) => Promise<void>) => {
    const root = await rootDir('codes');
    await setup(root);
    const { diagnostics } = await discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
      appVersion: '1.0.0',
      platform: 'linux',
    });
    return diagnostics.map(({ diagnostic }) => diagnostic);
  };

  it('manifest-unreadable: данные — причина', async () => {
    const [diagnostic] = await codes(async (root) => {
      await mkdir(path.join(root, 'acme.broken'));
      await writeFile(path.join(root, 'acme.broken/extension.json'), '{');
    });
    expect(diagnostic?.code).toBe('manifest-unreadable');
    expect(typeof diagnostic?.data.reason).toBe('string');
  });

  it('manifest-invalid: issues — путь и сообщение', async () => {
    const [diagnostic] = await codes(async (root) => {
      await makeExtension(root, 'acme.bad', { extra: { version: 'x' } });
    });
    expect(diagnostic).toEqual({
      code: 'manifest-invalid',
      data: { issues: ['version: version must be semver'] },
    });
  });

  it('id-mismatch: имя каталога и id манифеста', async () => {
    const found = await codes(async (root) => {
      await makeExtension(root, 'acme.dir', { manifestId: 'acme.other' });
    });
    expect(found).toEqual([
      {
        code: 'id-mismatch',
        data: { expected: 'acme.dir', actual: 'acme.other' },
      },
    ]);
  });

  it('requires-app и unavailable-platform', async () => {
    const found = await codes(async (root) => {
      await makeExtension(root, 'acme.new', {
        extra: { minAppVersion: '2.0.0' },
      });
      await makeExtension(root, 'acme.win', {
        extra: { platforms: ['win32'] },
      });
    });
    expect(found).toEqual([
      { code: 'requires-app', data: { minAppVersion: '2.0.0' } },
      { code: 'unavailable-platform', data: { platform: 'linux' } },
    ]);
  });

  it('claim-clash: вклад, имя и владелец', async () => {
    const found = await codes(async (root) => {
      await makeExtension(root, 'acme.a', { markdown: 'shared' });
      await makeExtension(root, 'acme.b', { markdown: 'shared' });
    });
    expect(found).toEqual([
      {
        code: 'claim-clash',
        data: { kind: 'markdown', name: 'shared', by: 'acme.a' },
      },
    ]);
  });

  it('load-failed: причина — сообщение загрузки', async () => {
    const found = await codes(async (root) => {
      await makeExtension(root, 'acme.nomain', { withMain: false });
    });
    expect(found).toEqual([
      {
        code: 'load-failed',
        data: { reason: "main './main.mjs' (default) is not a file" },
      },
    ]);
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
      'dolphy-ext://acme.ok/view.mjs',
    );
  });

  it('невалидный манифест — сообщение парсера', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.bad');
    await writeFile(path.join(root, 'acme.bad', 'extension.json'), '{}');
    const result = await inspectExtensionDir(path.join(root, 'acme.bad'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatDiagnostic(result.diagnostic)).toContain('id');
  });

  it('нет main.mjs по умолчанию — сообщение называет файл', async () => {
    const root = await rootDir('r');
    await makeExtension(root, 'acme.nomain', { withMain: false });
    const dir = path.join(root, 'acme.nomain');
    const strict = await inspectExtensionDir(dir);
    expect(strict).toEqual({
      ok: false,
      id: 'acme.nomain',
      diagnostic: {
        code: 'load-failed',
        data: { reason: "main './main.mjs' (default) is not a file" },
      },
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

describe('совместимость с приложением', () => {
  const discover = async (
    extra: Record<string, unknown>,
    options: { appVersion?: string; platform?: string },
  ) => {
    const root = await rootDir('compat');
    await makeExtension(root, 'acme.c', { extra });
    return discoverExtensions({
      roots: [{ dir: root, origin: 'user' }],
      logger: createLogger(),
      ...options,
    });
  };

  it('minAppVersion новее приложения — пропуск с диагностикой и state invalid', async () => {
    const result = await discover(
      { minAppVersion: '1.2.0' },
      { appVersion: '1.1.9' },
    );
    expect(result.extensions).toEqual([]);
    expect(formatDiagnostic(result.diagnostics[0]!.diagnostic)).toBe(
      'requires app >= 1.2.0',
    );
    const holder = createDiscoveryHolder(result);
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    expect(registry.list()).toMatchObject([{ id: 'acme.c', state: 'invalid' }]);
  });

  it.each(['1.2.0', '1.3.0'])(
    'appVersion %s принимает minAppVersion 1.2.0',
    async (appVersion) => {
      const result = await discover({ minAppVersion: '1.2.0' }, { appVersion });
      expect(result.extensions[0]).toMatchObject({
        minAppVersion: '1.2.0',
      });
    },
  );

  it('appVersion не задана — minAppVersion не проверяется', async () => {
    const result = await discover({ minAppVersion: '99.0.0' }, {});
    expect(result.extensions).toHaveLength(1);
  });

  it('платформа не входит в platforms — пропуск', async () => {
    const result = await discover(
      { platforms: ['darwin', 'linux'] },
      { platform: 'win32' },
    );
    expect(result.extensions).toEqual([]);
    expect(formatDiagnostic(result.diagnostics[0]!.diagnostic)).toBe(
      'not available on win32',
    );
  });

  it('платформа входит в platforms или platforms пусто — принимается', async () => {
    const listed = await discover(
      { platforms: ['linux'], name: 'Q', author: 'octo-cat' },
      { platform: 'linux' },
    );
    expect(listed.extensions[0]).toMatchObject({
      platforms: ['linux'],
      name: 'Q',
      author: 'octo-cat',
      description: null,
    });
    const any = await discover({ platforms: [] }, { platform: 'win32' });
    expect(any.extensions).toHaveLength(1);
  });

  it('inspectExtensionDir применяет те же проверки', async () => {
    const root = await rootDir('inspect');
    await makeExtension(root, 'acme.i', { extra: { minAppVersion: '2.0.0' } });
    const dir = path.join(root, 'acme.i');
    expect(await inspectExtensionDir(dir, { appVersion: '1.0.0' })).toEqual({
      ok: false,
      id: 'acme.i',
      diagnostic: { code: 'requires-app', data: { minAppVersion: '2.0.0' } },
    });
    expect((await inspectExtensionDir(dir)).ok).toBe(true);
  });
});
