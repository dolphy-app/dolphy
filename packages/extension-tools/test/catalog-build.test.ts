import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseIndex } from '@spirula-app/extension-catalog';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog/build.ts';
import type { BuildCatalogOptions } from '../src/catalog/build.ts';
import { BuildError } from '../src/errors.ts';
import { createRepo, readJson, setVersion } from './catalog-helpers.ts';
import type { Repo } from './catalog-helpers.ts';
import { makeTemp } from './helpers.ts';

const NIGHT = 'acme.night';
const NOW = new Date('2026-10-02T10:00:00.000Z');

const publish = async (
  repo: Repo,
  out: string,
  ids: string[],
  extra: Partial<BuildCatalogOptions> = {},
) =>
  buildCatalog({
    src: repo.extensionsDir,
    ids,
    out,
    now: () => NOW,
    ...extra,
  });

const indexOf = async (out: string) =>
  parseIndex(await readJson(path.join(out, 'index.json')));

const sha256 = async (file: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

const listFiles = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();

describe('catalog build: публикация версии', () => {
  it('кладёт файлы версии и README, индекс описывает их размерами и sha256', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const results = await publish(repo, out, [NIGHT]);
    expect(results).toEqual([
      {
        id: NIGHT,
        version: '1.0.0',
        status: 'published',
        files: 2,
        bytes: expect.any(Number),
      },
    ]);
    const versionDir = path.join(out, 'extensions', NIGHT, '1.0.0');
    expect(await listFiles(versionDir)).toEqual([
      'README.md',
      'extension.json',
    ]);

    const index = await indexOf(out);
    expect(index.generatedAt).toBe(NOW.toISOString());
    const [entry] = index.extensions;
    expect(entry).toMatchObject({
      id: NIGHT,
      name: 'Sample',
      description: 'A sample extension for the catalog',
      author: 'octo-cat',
      source: `https://github.com/spirula-app/spirula-extensions/tree/main/extensions/${NIGHT}`,
      platforms: [],
      contributes: {
        exerciseTypes: [],
        themes: [NIGHT],
        markdownRenderers: [],
        gradePolicies: [],
      },
    });
    const [version] = entry?.versions ?? [];
    expect(version).toMatchObject({
      version: '1.0.0',
      apiVersion: 1,
      minAppVersion: null,
      permissions: [],
      publishedAt: NOW.toISOString(),
      baseUrl: `extensions/${NIGHT}/1.0.0/`,
    });
    for (const file of version?.files ?? []) {
      const target = path.join(versionDir, file.path);
      expect(file.size).toBe((await stat(target)).size);
      expect(file.sha256).toBe(await sha256(target));
    }
    expect(results[0]?.bytes).toBe(
      version?.files.reduce((sum, file) => sum + file.size, 0),
    );
  });

  it('файл index.json: два пробела, завершающий перевод строки, стабильный порядок ключей', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const text = await readFile(path.join(out, 'index.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(text);
    expect(text).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'generatedAt',
      'extensions',
      'revoked',
    ]);
    expect(Object.keys(parsed.extensions[0].versions[0])).toEqual([
      'version',
      'apiVersion',
      'minAppVersion',
      'permissions',
      'publishedAt',
      'baseUrl',
      'files',
    ]);
  });

  it('собирает расширения с кодом и разметкой, уважает source-base и published-at', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
      { fixture: 'hello', manifest: { minAppVersion: '1.2.0' } },
    ]);
    const out = await makeTemp();
    const results = await publish(repo, out, ['acme.hello', 'acme.chart'], {
      sourceBase: 'https://example.org/src/',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    expect(results.map((result) => result.id)).toEqual([
      'acme.hello',
      'acme.chart',
    ]);
    const index = await indexOf(out);
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'acme.chart',
      'acme.hello',
    ]);
    const hello = index.extensions[1];
    expect(hello?.source).toBe('https://example.org/src/acme.hello');
    expect(hello?.contributes.exerciseTypes).toEqual(['acme.hello']);
    expect(hello?.versions[0]?.minAppVersion).toBe('1.2.0');
    expect(hello?.versions[0]?.publishedAt).toBe('2026-01-01T00:00:00Z');
    const paths = hello?.versions[0]?.files.map((file) => file.path);
    expect(paths).toContain('main.mjs');
    expect(paths).toContain('README.md');
    expect(index.extensions[0]?.contributes.markdownRenderers).toEqual([
      'chart',
    ]);
  });
});

describe('catalog build: неизменность версий', () => {
  it('повторная сборка тех же исходников — no-op, publishedAt сохраняется', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const before = await indexOf(out);
    const again = await publish(repo, out, [NIGHT], {
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(again[0]?.status).toBe('unchanged');
    const after = await indexOf(out);
    expect(after.extensions).toEqual(before.extensions);
    expect(after.generatedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('другое содержимое той же версии — ошибка, диск и индекс не тронуты', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const indexBefore = await readFile(path.join(out, 'index.json'), 'utf8');
    const manifestBefore = await readFile(
      path.join(out, 'extensions', NIGHT, '1.0.0', 'extension.json'),
      'utf8',
    );
    await writeFile(path.join(repo.dirOf(NIGHT), 'README.md'), '# changed\n');
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(
      /already published with different content/,
    );
    expect(await readFile(path.join(out, 'index.json'), 'utf8')).toBe(
      indexBefore,
    );
    expect(
      await readFile(
        path.join(out, 'extensions', NIGHT, '1.0.0', 'extension.json'),
        'utf8',
      ),
    ).toBe(manifestBefore);
  });

  it('содержимое, расходящееся с записью индекса при отсутствующем каталоге, — тоже ошибка', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const first = await makeTemp();
    await publish(repo, first, [NIGHT]);
    await writeFile(path.join(repo.dirOf(NIGHT), 'README.md'), '# changed\n');
    const second = await makeTemp();
    await expect(
      publish(repo, second, [NIGHT], {
        previousIndex: path.join(first, 'index.json'),
      }),
    ).rejects.toBeInstanceOf(BuildError);
    await expect(stat(path.join(second, 'index.json'))).rejects.toThrow();
  });

  it('недостающий каталог версии восстанавливается при совпадении с записью индекса', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const first = await makeTemp();
    await publish(repo, first, [NIGHT]);
    const second = await makeTemp();
    const results = await publish(repo, second, [NIGHT], {
      previousIndex: path.join(first, 'index.json'),
    });
    expect(results[0]?.status).toBe('published');
    expect(await listFiles(path.join(second, 'extensions', NIGHT))).toEqual([
      '1.0.0/README.md',
      '1.0.0/extension.json',
    ]);
  });
});

describe('catalog build: слияние индекса', () => {
  it('сохраняет записи не пересобранных расширений и берёт индекс из <out>', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    await publish(repo, out, ['acme.chart']);
    const index = await indexOf(out);
    expect(index.extensions.map((entry) => entry.id)).toEqual([
      'acme.chart',
      NIGHT,
    ]);
  });

  it('--previous-index начинает с чужого индекса', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const previous = await makeTemp();
    await publish(repo, previous, [NIGHT]);
    const out = await makeTemp();
    await publish(repo, out, ['acme.chart'], {
      previousIndex: path.join(previous, 'index.json'),
    });
    const ids = (await indexOf(out)).extensions.map((entry) => entry.id);
    expect(ids).toEqual(['acme.chart', NIGHT]);
  });

  it('хранит пять новых версий по убыванию; шестая уходит из индекса, но не с диска', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    for (const version of [
      '1.0.0',
      '1.1.0',
      '1.0.1',
      '2.0.0',
      '1.2.0',
      '1.3.0',
    ]) {
      await setVersion(repo, NIGHT, version);
      await publish(repo, out, [NIGHT]);
    }
    const [entry] = (await indexOf(out)).extensions;
    expect(entry?.versions.map((version) => version.version)).toEqual([
      '2.0.0',
      '1.3.0',
      '1.2.0',
      '1.1.0',
      '1.0.1',
    ]);
    const onDisk = await readdir(path.join(out, 'extensions', NIGHT));
    expect(onDisk.sort()).toEqual([
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '1.2.0',
      '1.3.0',
      '2.0.0',
    ]);
  });

  it('отзывы: переносятся из прежнего индекса и перекрываются --revoked', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    const revokedFile = path.join(await makeTemp(), 'revoked.json');
    const revoked = [{ id: NIGHT, versions: '<1.0.0', reason: 'bad' }];
    await writeFile(revokedFile, JSON.stringify(revoked));
    await publish(repo, out, [NIGHT], { revoked: revokedFile });
    expect((await indexOf(out)).revoked).toEqual(revoked);

    await setVersion(repo, NIGHT, '1.0.1');
    await publish(repo, out, [NIGHT]);
    expect((await indexOf(out)).revoked).toEqual(revoked);

    const replacement = [{ id: NIGHT, versions: '<=1.0.0', reason: 'worse' }];
    await writeFile(revokedFile, JSON.stringify(replacement));
    await setVersion(repo, NIGHT, '1.0.2');
    await publish(repo, out, [NIGHT], { revoked: revokedFile });
    expect((await indexOf(out)).revoked).toEqual(replacement);
  });
});

describe('catalog build: отказы ничего не пишут', () => {
  it('невалидный результат (publishedAt) оставляет прежний индекс и каталоги нетронутыми', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only' },
    ]);
    const out = await makeTemp();
    await publish(repo, out, [NIGHT]);
    const before = await readFile(path.join(out, 'index.json'), 'utf8');
    await expect(
      publish(repo, out, ['acme.chart'], { publishedAt: 'yesterday' }),
    ).rejects.toThrow(/resulting index is invalid/);
    expect(await readFile(path.join(out, 'index.json'), 'utf8')).toBe(before);
    expect(await readdir(path.join(out, 'extensions'))).toEqual([NIGHT]);
  });

  it('ошибка во втором расширении не оставляет следов первого', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only' },
      { fixture: 'markdown-only', files: { 'README.md': null } },
    ]);
    const out = await makeTemp();
    await expect(publish(repo, out, [NIGHT, 'acme.chart'])).rejects.toThrow(
      /README.md is missing/,
    );
    expect(await readdir(out)).toEqual([]);
  });

  it('битый прежний индекс и не-массив --revoked — ошибки', async () => {
    const repo = await createRepo([{ fixture: 'theme-only' }]);
    const out = await makeTemp();
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'index.json'), '{"schemaVersion":7}');
    await expect(publish(repo, out, [NIGHT])).rejects.toThrow(
      /not a valid catalog index/,
    );
    const clean = await makeTemp();
    const revoked = path.join(clean, 'r.json');
    await writeFile(revoked, '{}');
    await expect(publish(repo, clean, [NIGHT], { revoked })).rejects.toThrow(
      /must be a JSON array/,
    );
  });

  it('файлы вне схемы каталога (assets/logo.png), пустой README и несовпадение имён отклоняются', async () => {
    const out = await makeTemp();
    const png = await createRepo([
      { fixture: 'theme-only', files: { 'assets/logo.png': 'x' } },
    ]);
    await expect(publish(png, out, [NIGHT])).rejects.toThrow(
      /assets\/logo\.png' is not allowed/,
    );
    const empty = await createRepo([
      { fixture: 'theme-only', files: { 'README.md': ' ' } },
    ]);
    await expect(publish(empty, out, [NIGHT])).rejects.toThrow(/README/);
    const moved = await createRepo([
      { fixture: 'theme-only', dirName: 'other' },
    ]);
    await expect(publish(moved, out, ['other'])).rejects.toThrow(
      /does not match manifest id/,
    );
  });

  it('без name/description/author сборка отказывает', async () => {
    const repo = await createRepo([
      { fixture: 'theme-only', manifest: { author: undefined } },
    ]);
    await expect(publish(repo, await makeTemp(), [NIGHT])).rejects.toThrow(
      /lacks publication metadata: author/,
    );
  });
});
