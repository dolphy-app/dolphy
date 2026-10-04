import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@dolphy-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildExtension, validateExtension } from '../src/index.ts';
import { buildCatalog } from '../src/catalog/build.ts';
import { checkCatalog, formatFinding } from '../src/catalog/check.ts';
import { runCli } from '../src/cli/run.ts';
import { lintProject } from '../src/lint/index.ts';
import { createRepo, readJson } from './catalog-helpers.ts';
import type { ExtensionSpec } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const ID = 'acme.night';
const theme = (label: string) => ({
  themes: [
    {
      id: ID,
      label,
      dark: true,
      colors: { background: '#101018', primary: '#8ab4f8' },
    },
  ],
});

const json = (value: unknown): string => JSON.stringify(value);

const EN = {
  name: 'Night theme',
  description: 'A dark theme with a deep blue background',
  theme: 'Night',
};

/** A localized theme extension: every localizable field is a `%key%`. */
const localized = (
  files: Record<string, string | null> = {},
  contributes: unknown = theme('%theme%'),
): Partial<ExtensionSpec> => ({
  manifest: { name: '%name%', description: '%description%', contributes },
  files: {
    'locales/en.json': json(EN),
    'locales/ru.json': json({
      name: 'Ночная тема',
      description: 'Тёмная тема с глубоким синим фоном',
      theme: 'Ночь',
    }),
    ...files,
  },
});

const check = async (spec: Partial<ExtensionSpec>): Promise<string[]> => {
  const repo = await createRepo([{ fixture: 'theme-only', ...spec }]);
  return (
    await checkCatalog({
      extensionsDir: repo.extensionsDir,
      skipGithubCheck: true,
    })
  ).map(formatFinding);
};

describe('catalog check: translations (CHECK-026)', () => {
  it('a complete localized project has no findings', async () => {
    expect(await check(localized())).toEqual([]);
  });

  it('requires locales/en.json when the manifest has a %key%', async () => {
    const lines = (await check(localized({ 'locales/en.json': null }))).filter(
      (line) => line.includes('CHECK-026'),
    );
    expect(lines).toEqual([
      'error acme.night CHECK-026 locales/en.json: locales/en.json is required: the manifest uses %key% placeholders',
    ]);
  });

  it('reports a key that en lacks at the first field that uses it', async () => {
    const lines = await check(
      localized({ 'locales/en.json': json({ ...EN, theme: undefined }) }),
    );
    expect(lines).toEqual([
      "error acme.night CHECK-026 contributes.themes.0.label: '%theme%' has no text in locales/en.json",
    ]);
  });

  it('a key present only in ru is still an error', async () => {
    const lines = await check(
      localized({
        'locales/en.json': json({ name: EN.name, description: EN.description }),
      }),
    );
    expect(lines.filter((line) => line.includes('CHECK-026'))).toHaveLength(1);
    expect(lines.join('\n')).toContain("'%theme%' has no text in");
  });

  it('reports a text that breaks the limit of its field, per language', async () => {
    const lines = await check(
      localized({
        'locales/ru.json': json({
          name: 'Ночная тема',
          description: 'Тёмная тема с глубоким синим фоном',
          theme: 'я'.repeat(61),
        }),
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^error acme\.night CHECK-026 contributes\.themes\.0\.label: the ru text of '%theme%' is not valid for this field: /,
    );
  });

  it('checks the length of the resolved name and description (CHECK-003)', async () => {
    const lines = await check(
      localized({
        'locales/en.json': json({ ...EN, name: 'x'.repeat(81) }),
      }),
    );
    expect(lines.some((line) => line.includes('CHECK-003 name:'))).toBe(true);
  });

  it('a short resolved description is a warning (CHECK-019), not the placeholder length', async () => {
    const lines = await check(
      localized({ 'locales/en.json': json({ ...EN, description: 'Short' }) }),
    );
    expect(lines).toEqual([
      expect.stringMatching(/^warning acme\.night CHECK-019 description:/),
    ]);
  });

  it.each([
    ['not JSON', '{ nope'],
    ['an array', '["a"]'],
    ['a nested value', json({ ...EN, theme: { a: 'b' } })],
    ['a key with a space', json({ ...EN, 'bad key': 'x' })],
  ])('rejects a file with an invalid shape: %s', async (_name, content) => {
    const lines = await check(localized({ 'locales/ru.json': content }));
    expect(lines.length).toBeGreaterThan(0);
    expect(
      lines.every((line) =>
        line.startsWith('error acme.night CHECK-026 locales/ru.json: '),
      ),
    ).toBe(true);
  });

  it('warns about a key the manifest does not use and about unsupported files', async () => {
    const lines = await check(
      localized({
        'locales/ru.json': json({ ...EN, unused: 'x' }),
        'locales/de.json': json(EN),
        'locales/README.txt': 'notes',
      }),
    );
    expect(lines.sort()).toEqual(
      [
        "warning acme.night CHECK-026 locales/ru.json: key 'unused' is not used by extension.json",
        'warning acme.night CHECK-026 locales/README.txt: locales/README.txt is not a translation file (locales/ru.json, locales/en.json): the app ignores it',
        'warning acme.night CHECK-026 locales/de.json: locales/de.json is not a translation file (locales/ru.json, locales/en.json): the app ignores it',
      ].sort(),
    );
  });

  it('without placeholders a translation file is only checked for shape and unused keys', async () => {
    const lines = await check({
      files: { 'locales/en.json': json({ spare: 'x' }) },
    });
    expect(lines).toEqual([
      "warning acme.night CHECK-026 locales/en.json: key 'spare' is not used by extension.json",
    ]);
  });
});

describe('catalog build: English index', () => {
  it('writes name, description and titles from locales/en.json and ships the tables as version files', async () => {
    const repo = await createRepo([{ fixture: 'theme-only', ...localized() }]);
    const out = await makeTemp();
    await buildCatalog({ src: repo.extensionsDir, ids: [ID], out });
    const index = parseIndex(await readJson(path.join(out, 'index.v2.json')));
    const entry = index.extensions.find((item) => item.id === ID);
    expect(entry).toMatchObject({
      name: 'Night theme',
      description: 'A dark theme with a deep blue background',
      titles: { themes: { [ID]: 'Night' } },
    });
    const files = entry?.versions[0]?.files.map((file) => file.path) ?? [];
    expect(files).toEqual(
      expect.arrayContaining(['locales/en.json', 'locales/ru.json']),
    );
    // the published manifest itself keeps the placeholders: the app resolves them per language
    const published = (await readJson(
      path.join(out, 'extensions', ID, '1.0.0', 'extension.json'),
    )) as { name: string };
    expect(published.name).toBe('%name%');
  });

  it('refuses to publish when en lacks a key', async () => {
    const repo = await createRepo([
      {
        fixture: 'theme-only',
        ...localized({ 'locales/en.json': json({ name: 'Night theme' }) }),
      },
    ]);
    await expect(
      buildCatalog({
        src: repo.extensionsDir,
        ids: [ID],
        out: await makeTemp(),
      }),
    ).rejects.toThrow(/'%description%' has no text in locales\/en\.json/);
  });
});

describe('validate and build', () => {
  const project = async (spec: Partial<ExtensionSpec>): Promise<string> => {
    const repo = await createRepo([{ fixture: 'theme-only', ...spec }]);
    return repo.dirOf(ID);
  };

  it('build copies locales/ into the extension and validate accepts it', async () => {
    const root = await project(localized());
    const out = await makeTemp();
    const built = await buildExtension({ root, outDir: out });
    expect(built.files).toEqual(
      expect.arrayContaining(['locales/en.json', 'locales/ru.json']),
    );
    expect(await validateExtension(built.dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });

  it('build fails without locales/en.json and names the file', async () => {
    const root = await project(localized({ 'locales/en.json': null }));
    await expect(
      buildExtension({ root, outDir: await makeTemp() }),
    ).rejects.toThrow(/locales\/en\.json is required/);
  });

  it('build reports warnings through the logger and still succeeds', async () => {
    const root = await project(
      localized({ 'locales/ru.json': json({ ...EN, unused: 'x' }) }),
    );
    const info: string[] = [];
    await buildExtension({
      root,
      outDir: await makeTemp(),
      logger: { info: (message) => info.push(message), error: () => {} },
    });
    expect(info).toEqual([
      "warning acme.night: locales/ru.json: key 'unused' is not used by extension.json",
    ]);
  });

  it('validate prints warnings to stdout and keeps exit code 0', async () => {
    const root = await project(
      localized({ 'locales/ru.json': json({ ...EN, unused: 'x' }) }),
    );
    const out = await makeTemp();
    const built = await buildExtension({ root, outDir: out });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(['validate', built.dir], {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
    expect(code).toBe(0);
    expect(stdout.join('')).toContain(
      `warning ${built.dir}: locales/ru.json: key 'unused' is not used by extension.json`,
    );
    expect(stdout.join('')).toContain(`${built.dir}: ok`);
    expect(stderr).toEqual([]);
  });

  it('validate fails on a missing key in a built directory', async () => {
    const root = await project(localized());
    const built = await buildExtension({ root, outDir: await makeTemp() });
    await writeFile(
      path.join(built.dir, 'locales/en.json'),
      json({ name: 'N' }),
    );
    const result = await validateExtension(built.dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain(
      "contributes.themes.0.label: '%theme%' has no text in locales/en.json",
    );
    expect(
      await readFile(path.join(built.dir, 'extension.json'), 'utf8'),
    ).toContain('%theme%');
  });
});

describe('lint', () => {
  it('judges the English description, not the placeholder', async () => {
    const repo = await createRepo([
      {
        fixture: 'theme-only',
        ...localized({
          'locales/en.json': json({ ...EN, description: 'Short one' }),
        }),
      },
    ]);
    const findings = await lintProject({ root: repo.dirOf(ID) });
    expect(findings.map(({ ruleId }) => ruleId)).toContain('CHECK-019');
    expect(findings.map(({ ruleId }) => ruleId)).not.toContain('CHECK-003');
  });
});
