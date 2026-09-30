/**
 * T-15 (часть на реальной ФС): ассеты и каталоги не выводят чтение за корень
 * библиотеки ни симлинком, ни `..`; петли и огромные файлы дают диагностику,
 * а не зависание или падение.
 */
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Diagnostic, DiagnosticCode } from '@spirula/engine-contract';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/authoring/compile.ts';
import { createNodeFsCourseSource } from '../../src/node/index.ts';
import { useTmpDirs, writeFiles } from '../helpers/tmp.ts';

const tmp = useTmpDirs();

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const EXERCISE = 'c/l0/e0';

const flashcard = (front: string, back: string | null = null) => ({
  id: 'c::l0::e0',
  lesson_id: 'c::l0',
  course_id: 'c',
  name: 'e0',
  exercise_type: 'Procedural',
  exercise_asset: { FlashcardAsset: { front_path: front, back_path: back } },
});

/** Библиотека `<root>/lib` из одного курса, урока и упражнения; вне неё — `<root>/outside`. */
const setup = async (
  front: string,
  extra: Readonly<Record<string, string>> = {},
) => {
  const outer = await tmp.make('engine-sec-');
  const root = join(outer, 'lib');
  await writeFiles(root, {
    'c/course_manifest.json': json({ id: 'c', name: 'C' }),
    'c/l0/lesson_manifest.json': json({ id: 'c::l0', course_id: 'c' }),
    [`${EXERCISE}/exercise_manifest.json`]: json(flashcard(front)),
    [`${EXERCISE}/front.md`]: 'Question\n',
    ...extra,
  });
  await mkdir(join(outer, 'outside'), { recursive: true });
  await writeFile(join(outer, 'outside/secret.md'), 'SECRET\n');
  return { outer, root };
};

const codes = (diagnostics: readonly Diagnostic[], code: DiagnosticCode) =>
  diagnostics.filter((d) => d.code === code);

const errorsOf = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.filter(({ severity }) => severity === 'error');

describe('T-15: пути ассетов на реальной ФС', () => {
  it('базовая библиотека чиста (контроль для остальных случаев)', async () => {
    const { root } = await setup('front.md');
    const { diagnostics, artifact } = await compile(
      createNodeFsCourseSource(root),
    );
    expect(errorsOf(diagnostics)).toEqual([]);
    expect(artifact).not.toBeNull();
  });

  it('симлинк на файл вне корня в front_path: E_ASSET_ESCAPES_ROOT, файл не читается', async () => {
    const { outer, root } = await setup('front.md');
    await symlink(
      join(outer, 'outside/secret.md'),
      join(root, EXERCISE, 'linked.md'),
    );
    await writeFiles(root, {
      [`${EXERCISE}/exercise_manifest.json`]: json(flashcard('linked.md')),
    });
    const { diagnostics, artifact } = await compile(
      createNodeFsCourseSource(root),
    );
    const found = codes(diagnostics, 'E_ASSET_ESCAPES_ROOT');
    expect(found.map(({ path }) => path)).toContain(
      `${EXERCISE}/exercise_manifest.json`,
    );
    expect(found.every(({ unitId }) => unitId === 'c::l0::e0')).toBe(true);
    expect(artifact).toBeNull();
    // содержимое чужого файла не просочилось ни в диагностику, ни в модель
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
  });

  it('симлинк внутрь корня допустим', async () => {
    const { root } = await setup('front.md');
    await symlink('front.md', join(root, EXERCISE, 'alias.md'));
    await writeFiles(root, {
      [`${EXERCISE}/exercise_manifest.json`]: json(flashcard('alias.md')),
    });
    const { diagnostics } = await compile(createNodeFsCourseSource(root));
    expect(errorsOf(diagnostics)).toEqual([]);
  });

  it('симлинк-каталог наружу не обходится: юниты за ним не читаются', async () => {
    const { outer, root } = await setup('front.md');
    await writeFiles(outer, {
      'outside/course/course_manifest.json': json({ id: 'evil', name: 'Evil' }),
    });
    await symlink(join(outer, 'outside/course'), join(root, 'evil-link'));
    const { diagnostics, artifact } = await compile(
      createNodeFsCourseSource(root),
    );
    const escaped = codes(diagnostics, 'E_ASSET_ESCAPES_ROOT');
    expect(escaped.map(({ path }) => path)).toEqual(['evil-link']);
    expect(artifact).toBeNull();
    expect(JSON.stringify(diagnostics)).not.toContain('evil::');
  });

  it('путь через симлинк-каталог наружу в front_path: E_ASSET_ESCAPES_ROOT', async () => {
    const { outer, root } = await setup('front.md');
    await symlink(join(outer, 'outside'), join(root, EXERCISE, 'out'));
    await writeFiles(root, {
      [`${EXERCISE}/exercise_manifest.json`]: json(flashcard('out/secret.md')),
    });
    const { diagnostics } = await compile(createNodeFsCourseSource(root));
    expect(
      codes(diagnostics, 'E_ASSET_ESCAPES_ROOT').map(({ path }) => path),
    ).toContain(`${EXERCISE}/exercise_manifest.json`);
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
  });

  it('.. из каталога упражнения за корень: E_ASSET_ESCAPES_ROOT, внутри корня — нет', async () => {
    const { root } = await setup('../../../../outside/secret.md');
    const outside = await compile(createNodeFsCourseSource(root));
    expect(
      codes(outside.diagnostics, 'E_ASSET_ESCAPES_ROOT').map(
        ({ unitId }) => unitId,
      ),
    ).toEqual(['c::l0::e0']);

    await writeFiles(root, {
      'c/l0/shared.md': 'Shared question\n',
      [`${EXERCISE}/exercise_manifest.json`]: json(flashcard('../shared.md')),
    });
    const inside = await compile(createNodeFsCourseSource(root));
    expect(errorsOf(inside.diagnostics)).toEqual([]);
  });

  it('абсолютный путь ассета — от корня библиотеки, а не файловой системы', async () => {
    const { root } = await setup('/etc/hosts');
    const { diagnostics } = await compile(createNodeFsCourseSource(root));
    const missing = codes(diagnostics, 'E_ASSET_MISSING');
    expect(missing.map(({ unitId }) => unitId)).toEqual(['c::l0::e0']);
    expect(codes(diagnostics, 'E_ASSET_ESCAPES_ROOT')).toEqual([]);
  });

  it('петля симлинков-каталогов: компиляция завершается, петля — E_IO', async () => {
    const { root } = await setup('front.md');
    await symlink('..', join(root, 'c/l0/up'));
    const source = createNodeFsCourseSource(root);
    const { diagnostics } = await compile(source);
    const loops = codes(diagnostics, 'E_IO').filter(({ path }) =>
      path?.includes('up'),
    );
    expect(loops.length).toBeGreaterThan(0);
  }, 10_000);

  it('петля из двух ссылок-файлов и висячая ссылка: не зависают, библиотека читается', async () => {
    const { root } = await setup('front.md');
    await symlink('b', join(root, 'c/a'));
    await symlink('a', join(root, 'c/b'));
    await symlink('nowhere', join(root, 'c/dangling'));
    const { diagnostics } = await compile(createNodeFsCourseSource(root));
    expect(errorsOf(diagnostics)).toEqual([]);
  }, 10_000);

  it('front-файл 3 МБ: E_IO с путём файла, компиляция не падает', async () => {
    const { root } = await setup('front.md');
    await writeFile(
      join(root, EXERCISE, 'front.md'),
      'x'.repeat(3 * 1024 * 1024),
    );
    const { diagnostics, artifact } = await compile(
      createNodeFsCourseSource(root),
    );
    const large = codes(diagnostics, 'E_IO').filter(
      ({ path }) => path === `${EXERCISE}/front.md`,
    );
    expect(large).toHaveLength(1);
    expect(large[0]?.unitId).toBe('c::l0::e0');
    expect(artifact).toBeNull();
  });
});
