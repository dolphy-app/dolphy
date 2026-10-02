import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultElementName } from '@dolphy-app/extension-api';
import { parseManifest } from '@dolphy-app/extension-host';
import { describe, expect, it } from 'vitest';
import {
  GenerateError,
  deriveExtensionId,
  generateExtension,
} from '../src/index.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;

describe('deriveExtensionId', () => {
  it.each([
    ['acme-hello', 'acme-hello'],
    ['AcmeHello', 'acme-hello'],
    ['acme_hello', 'acme-hello'],
    ['acme.hello', 'acme-hello'],
    ['  My Ext!! ', 'my-ext'],
  ])('%s → %s', (name, id) => {
    expect(deriveExtensionId(name)).toBe(id);
  });
});

describe('generateExtension', () => {
  it('создаёт ровно заявленный набор файлов', async () => {
    const root = await makeTemp();
    const result = await generateExtension({
      dir: path.join(root, 'acme-hello'),
    });
    expect(result.id).toBe('acme-hello');
    expect(result.files).toEqual([
      '.gitignore',
      'README.md',
      'extension.json',
      'package.json',
      'src/index.ts',
      'test/index.test.ts',
      'tsconfig.json',
    ]);
  });

  it('id по умолчанию — kebab-case каталога, --id перекрывает', async () => {
    const root = await makeTemp();
    const derived = await generateExtension({
      dir: path.join(root, 'MyExt_One'),
    });
    expect(derived.id).toBe('my-ext-one');
    const explicit = await generateExtension({
      dir: path.join(root, 'plain'),
      id: 'acme.hello',
    });
    expect(explicit.id).toBe('acme.hello');
  });

  it.each([['123'], ['---'], ['Acme.Hello'], ['a'.repeat(65)]])(
    'отклоняет недопустимый id %s',
    async (id) => {
      const root = await makeTemp();
      const dir = path.join(root, 'ok');
      await expect(generateExtension({ dir, id })).rejects.toMatchObject({
        code: 'invalid-id',
      });
    },
  );

  it('отклоняет каталог, из имени которого id не выводится', async () => {
    const root = await makeTemp();
    await expect(
      generateExtension({ dir: path.join(root, '2024') }),
    ).rejects.toBeInstanceOf(GenerateError);
  });

  it('отказывает в непустом каталоге и ничего в нём не меняет', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await mkdir(dir);
    await writeFile(path.join(dir, 'keep.txt'), 'x');
    await expect(generateExtension({ dir })).rejects.toMatchObject({
      code: 'target-not-empty',
    });
    await expect(readFile(path.join(dir, 'keep.txt'), 'utf8')).resolves.toBe(
      'x',
    );
    await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();
  });

  it('принимает существующий пустой каталог', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await mkdir(dir);
    const result = await generateExtension({ dir });
    expect(result.dir).toBe(dir);
  });

  it('без --local зависимости условные', async () => {
    const root = await makeTemp();
    const { dir, isLocal } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isLocal).toBe(false);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-sdk': '^0.0.0',
      '@dolphy-app/extension-tools': '^0.0.0',
    });
  });

  it('--local пишет link: на пакеты репозитория', async () => {
    const root = await makeTemp();
    const { dir, isLocal } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      localRoot: REPO_ROOT,
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isLocal).toBe(true);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-sdk': `link:${REPO_ROOT}/packages/extension-sdk`,
      '@dolphy-app/extension-tools': `link:${REPO_ROOT}/packages/extension-tools`,
    });
  });

  it('с известной версией пакетов зависимости получают её caret-диапазон', async () => {
    const root = await makeTemp();
    const { dir, isPublished } = await generateExtension({
      dir: path.join(root, 'acme-hello'),
      packageVersion: '1.2.3',
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(isPublished).toBe(true);
    expect(pkg['devDependencies']).toMatchObject({
      '@dolphy-app/extension-sdk': '^1.2.3',
      '@dolphy-app/extension-tools': '^1.2.3',
    });
  });

  it('проект не получает .npmrc и раздел про токен: пакеты лежат в npmjs', async () => {
    const root = await makeTemp();
    for (const options of [
      { packageVersion: '1.2.3' },
      { localRoot: REPO_ROOT },
    ]) {
      const { dir, files } = await generateExtension({
        dir: path.join(root, options.localRoot === undefined ? 'npm' : 'local'),
        ...options,
      });
      expect(files).not.toContain('.npmrc');
      const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
      expect(readme).not.toContain('Установка зависимостей');
      expect(readme).not.toContain('_authToken');
    }
  });

  it('--local не на корень репозитория — ошибка до записи файлов', async () => {
    const root = await makeTemp();
    const dir = path.join(root, 'acme-hello');
    await expect(
      generateExtension({ dir, localRoot: root }),
    ).rejects.toMatchObject({ code: 'invalid-local' });
    await expect(readFile(path.join(dir, 'package.json'))).rejects.toThrow();
  });

  it('скрипты package.json ссылаются на id расширения', async () => {
    const root = await makeTemp();
    const { dir } = await generateExtension({
      dir: path.join(root, 'x'),
      id: 'acme.hello',
    });
    const pkg = await readJson(path.join(dir, 'package.json'));
    expect(pkg['scripts']).toEqual({
      build: 'dolphy-ext build',
      dev: 'dolphy-ext build --watch',
      validate: 'dolphy-ext validate dist-ext/acme.hello',
      test: 'vitest run',
    });
    await expect(
      readJson(path.join(dir, 'tsconfig.json')),
    ).resolves.toMatchObject({
      compilerOptions: { strict: true, noEmit: true },
    });
  });

  it('манифест проходит parseManifest; код привязан к id вида из манифеста', async () => {
    const root = await makeTemp();
    const { dir, id } = await generateExtension({
      dir: path.join(root, 'x'),
      id: 'acme.hello',
    });
    const parsed = parseManifest(
      await readJson(path.join(dir, 'extension.json')),
    );
    if (!parsed.ok) throw new Error(parsed.message);
    const [type] = parsed.manifest.contributes.exerciseTypes;
    expect(type?.id).toBe(id);
    expect(type?.element).toBe(defaultElementName(id));
    const index = await readFile(path.join(dir, 'src/index.ts'), 'utf8');
    expect(index).toContain(`'${id}': defineExerciseType`);
    expect(index).toContain(`'${id}': defineAnswerView`);
    expect(index).not.toContain('defineAnswerElement');
  });
});
