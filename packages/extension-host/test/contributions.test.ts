import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createDiscoveryHolder } from '../src/holder.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { parseManifest } from '../src/manifest.ts';
import { CONTRIBUTION_POINTS } from '../src/points/index.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

const fixturesDir = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const base = { id: 'acme.pt', version: '1.0.0', apiVersion: 1 };

const theme = (patch: Record<string, unknown> = {}) => ({
  id: 'acme.pt.dark',
  label: 'Dark',
  dark: true,
  colors: { background: '#000000' },
  ...patch,
});

const withContributes = (contributes: Record<string, unknown>) => ({
  ...base,
  contributes,
});

describe('реестр точек вклада', () => {
  it('содержит все одиннадцать точек с уникальными ключами', () => {
    expect(CONTRIBUTION_POINTS.map(({ key }) => key)).toEqual([
      'exerciseTypes',
      'themes',
      'markdownRenderers',
      'gradePolicies',
      'settings',
      'events',
      'commands',
      'panels',
      'widgets',
      'importers',
      'exporters',
    ]);
  });

  it('неизвестный ключ contributes отклоняется', () => {
    const result = parseManifest(
      withContributes({ themes: [theme()], gadgets: [] }),
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ['пустой contributes', {}],
    ['только пустые массивы', { themes: [], gradePolicies: [] }],
  ])('%s: нужен хотя бы один вклад', (_name, contributes) => {
    expect(parseManifest(withContributes(contributes))).toEqual({
      ok: false,
      diagnostic: {
        code: 'manifest-invalid',
        data: {
          issues: ['contributes: at least one contribution is required'],
        },
      },
    });
  });
});

describe('main зависит от точек', () => {
  it('темы и рендереры не требуют кода: main = null', () => {
    const result = parseManifest(
      withContributes({
        themes: [theme()],
        markdownRenderers: [{ language: 'chart' }],
      }),
    );
    expect(result).toMatchObject({ ok: true, manifest: { main: null } });
  });

  it('правило оценки требует код: main по умолчанию', () => {
    const result = parseManifest(
      withContributes({ gradePolicies: [{ id: 'acme.pt', label: 'X' }] }),
    );
    expect(result).toMatchObject({
      ok: true,
      manifest: { main: './main.mjs' },
    });
  });

  it('явный main сохраняется, даже если код не нужен', () => {
    const result = parseManifest({
      ...withContributes({ themes: [theme()] }),
      main: './x.mjs',
    });
    expect(result).toMatchObject({ ok: true, manifest: { main: './x.mjs' } });
  });

  it('нормализованный манифест содержит массивы всех восьми точек', () => {
    const result = parseManifest(withContributes({ themes: [theme()] }));
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.manifest.contributes).toMatchObject({
      exerciseTypes: [],
      markdownRenderers: [],
      gradePolicies: [],
      settings: [],
      events: [],
      commands: [],
      panels: [],
      importers: [],
      exporters: [],
    });
  });
});

describe('точка themes', () => {
  const themed = (patch: Record<string, unknown>) =>
    parseManifest(withContributes({ themes: [theme(patch)] }));

  it('принимает тему с переменными и альфа-каналом', () => {
    expect(
      themed({
        id: 'acme.pt',
        colors: { primary: '#aabbccdd' },
        variables: { 'border-color': '#112233', 'border-opacity': 0.5 },
      }).ok,
    ).toBe(true);
  });

  it.each([
    ['id вне префикса', { id: 'other.dark' }],
    ['встроенный id', { id: 'dark' }],
    ['пустая подпись', { label: '' }],
    ['подпись длиннее 60', { label: 'x'.repeat(61) }],
    ['dark не boolean', { dark: 'yes' }],
    ['пустые цвета', { colors: {} }],
    ['неизвестный ключ цвета', { colors: { accent: '#000000' } }],
    ['цвет не hex', { colors: { background: 'red' } }],
    ['цвет из трёх цифр', { colors: { background: '#000' } }],
    ['неизвестная переменная', { variables: { gap: 1 } }],
    ['непрозрачность больше 1', { variables: { 'border-opacity': 2 } }],
    ['border-color числом', { variables: { 'border-color': 1 } }],
    ['непрозрачность строкой', { variables: { 'border-opacity': '0.5' } }],
  ])('отклоняет: %s', (_name, patch) => {
    expect(themed(patch).ok).toBe(false);
  });
});

describe('точка markdownRenderers', () => {
  const rendered = (entry: Record<string, unknown>) =>
    parseManifest(withContributes({ markdownRenderers: [entry] }));

  it('подставляет рендерер по умолчанию', () => {
    const result = rendered({ language: 'math' });
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        contributes: {
          markdownRenderers: [{ language: 'math', renderer: './markdown.mjs' }],
        },
      },
    });
  });

  it.each([
    ['заглавные буквы', { language: 'Math' }],
    ['пустой язык', { language: '' }],
    ['язык длиннее 32', { language: 'a'.repeat(33) }],
    ['рендерер не .js/.mjs', { language: 'math', renderer: './m.ts' }],
    ['.. в пути', { language: 'math', renderer: '../m.mjs' }],
  ])('отклоняет: %s', (_name, entry) => {
    expect(rendered(entry).ok).toBe(false);
  });
});

describe('точка gradePolicies', () => {
  const policy = (entry: Record<string, unknown>) =>
    parseManifest(withContributes({ gradePolicies: [entry] }));

  it('принимает id под префиксом расширения', () => {
    expect(policy({ id: 'acme.pt.strict', label: 'Strict' }).ok).toBe(true);
  });

  it.each([
    ['id вне префикса', { id: 'other.x', label: 'X' }],
    ['без подписи', { id: 'acme.pt.x', label: '' }],
    ['подпись длиннее 60', { id: 'acme.pt.x', label: 'x'.repeat(61) }],
  ])('отклоняет: %s', (_name, entry) => {
    expect(policy(entry).ok).toBe(false);
  });

  it('встроенный passAtN зарезервирован', () => {
    expect(
      parseManifest({
        id: 'passAtN',
        version: '1.0.0',
        apiVersion: 1,
        contributes: { gradePolicies: [{ id: 'passAtN', label: 'X' }] },
      }).ok,
    ).toBe(false);
  });
});

describe('обнаружение вкладов без кода', () => {
  it('расширение из одних тем загружается без файлов кода', async () => {
    const result = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.themes'),
    );
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.extension.mainPath).toBeNull();
    expect(result.extension.themes).toEqual([
      {
        id: 'acme.themes.night',
        label: 'Night',
        dark: true,
        colors: { background: '#101018', primary: '#8ab4f8' },
        variables: { 'border-opacity': 0.2 },
      },
    ]);
  });

  it('расширение из одного рендерера: адрес модуля, mainPath = null', async () => {
    const result = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.markdown'),
    );
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    expect(result.extension.mainPath).toBeNull();
    expect(result.extension.markdownRenderers).toEqual([
      {
        language: 'chart',
        title: null,
        rendererUrl: 'dolphy-ext://acme.markdown/markdown.mjs',
      },
    ]);
  });

  it('смешанное расширение отдаёт все точки и код', async () => {
    const result = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.mixed'),
    );
    if (!result.ok) throw new Error(formatDiagnostic(result.diagnostic));
    const { extension } = result;
    expect(extension.mainPath).toBe(
      path.join(fixturesDir, 'acme.mixed', 'main.mjs'),
    );
    expect(extension.exerciseTypes).toHaveLength(1);
    expect(extension.themes.map(({ id }) => id)).toEqual(['acme.mixed.paper']);
    expect(extension.gradePolicies).toEqual([
      { id: 'acme.mixed.strict', label: 'Strict' },
    ]);
  });

  it('нет файла рендерера — расширение отклонено при verifyFiles', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dolphy-contrib-'));
    try {
      await mkdir(path.join(dir, 'acme.md'));
      await writeFile(
        path.join(dir, 'acme.md', 'extension.json'),
        JSON.stringify({
          ...base,
          id: 'acme.md',
          contributes: { markdownRenderers: [{ language: 'math' }] },
        }),
      );
      const strict = await discoverExtensions({
        roots: [{ dir, origin: 'user' }],
        logger: createLogger(),
      });
      expect(strict.extensions).toEqual([]);
      expect(formatDiagnostic(strict.diagnostics[0]!.diagnostic)).toContain(
        "markdown renderer './markdown.mjs' (default) is not a file",
      );
      const lax = await discoverExtensions({
        roots: [{ dir, origin: 'user' }],
        logger: createLogger(),
        verifyFiles: false,
      });
      expect(lax.extensions.map(({ id }) => id)).toEqual(['acme.md']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('конфликты вкладов между расширениями', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dolphy-clash-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const write = async (
    id: string,
    contributes: Record<string, unknown>,
  ): Promise<void> => {
    await mkdir(path.join(root, id), { recursive: true });
    await writeFile(
      path.join(root, id, 'extension.json'),
      JSON.stringify({ ...base, id, contributes }),
    );
  };

  const clashes: [string, () => Record<string, unknown>, string][] = [
    [
      'тема',
      () => ({ themes: [theme({ id: 'a.x' })] }),
      "theme 'a.x' is already provided by 'a'",
    ],
    [
      'язык рендерера',
      () => ({ markdownRenderers: [{ language: 'chart' }] }),
      "markdown 'chart' is already provided by 'a'",
    ],
    [
      'правило оценки',
      () => ({ gradePolicies: [{ id: 'a.x', label: 'X' }] }),
      "gradePolicy 'a.x' is already provided by 'a'",
    ],
  ];

  it.each(clashes)(
    '%s: первое расширение выигрывает',
    async (_name, make, message) => {
      await write('a', make());
      await write('a.x', make());
      await writeFile(path.join(root, 'a', 'markdown.mjs'), '');
      await writeFile(path.join(root, 'a.x', 'markdown.mjs'), '');
      for (const dir of ['a', 'a.x']) {
        await writeFile(path.join(root, dir, 'main.mjs'), '');
      }
      const result = await discoverExtensions({
        roots: [{ dir: root, origin: 'user' }],
        logger: createLogger(),
      });
      expect(result.extensions.map(({ id }) => id)).toEqual(['a']);
      expect(
        result.diagnostics.map(({ extensionId, diagnostic }) => [
          extensionId,
          formatDiagnostic(diagnostic),
        ]),
      ).toEqual([['a.x', message]]);
    },
  );
});

describe('createExtensionRegistry: contributions', () => {
  it('собирает вклады загруженных расширений', async () => {
    const themes = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.themes'),
    );
    const mixed = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.mixed'),
    );
    if (!themes.ok || !mixed.ok) throw new Error('fixtures must load');
    const discovery = createDiscoveryHolder({
      extensions: [
        {
          ...themes.extension,
          origin: 'user' as const,
          revision: '',
          install: null,
        },
        {
          ...mixed.extension,
          origin: 'bundled' as const,
          revision: '',
          install: null,
        },
      ],
      overridden: [],
      diagnostics: [],
    });
    const registry = createExtensionRegistry(
      discovery,
      createExtensionPolicy(discovery),
    );
    const contributions = registry.contributions();
    expect(contributions.themes.map(({ id }) => id).sort()).toEqual([
      'acme.mixed.paper',
      'acme.themes.night',
    ]);
    expect(contributions.gradePolicies).toEqual([
      { id: 'acme.mixed.strict', extensionId: 'acme.mixed', label: 'Strict' },
    ]);
    const list = registry.list();
    expect(list.find(({ id }) => id === 'acme.themes')?.contributes).toEqual({
      exerciseTypes: [],
      themes: ['acme.themes.night'],
      markdownRenderers: [],
      gradePolicies: [],
      settings: [],
      events: [],
      commands: [],
      panels: [],
      widgets: [],
      importers: [],
      exporters: [],
    });
  });

  it('отдаёт копии', async () => {
    const themes = await inspectExtensionDir(
      path.join(fixturesDir, 'acme.themes'),
    );
    if (!themes.ok) throw new Error(formatDiagnostic(themes.diagnostic));
    const discovery = createDiscoveryHolder({
      extensions: [
        {
          ...themes.extension,
          origin: 'user' as const,
          revision: '',
          install: null,
        },
      ],
      overridden: [],
      diagnostics: [],
    });
    const registry = createExtensionRegistry(
      discovery,
      createExtensionPolicy(discovery),
    );
    const [first] = registry.contributions().themes;
    if (first !== undefined) first.colors['background'] = '#ffffff';
    expect(registry.contributions().themes[0]?.colors['background']).toBe(
      '#101018',
    );
  });
});
