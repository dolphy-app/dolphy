import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { loadProject } from '../src/project.ts';
import { copyProject, linkSdk } from './helpers.ts';

const projectWithSdk = async (): Promise<string> => {
  const root = await copyProject('commands-panel');
  await linkSdk(root);
  return root;
};

interface EditableManifest {
  contributes: { panels?: { module?: string }[] };
}

const editManifest = async (
  root: string,
  edit: (manifest: EditableManifest) => void,
): Promise<void> => {
  const file = path.join(root, 'extension.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as EditableManifest;
  edit(manifest);
  await writeFile(file, JSON.stringify(manifest));
};

describe('панели и команды: проект', () => {
  it('модуль панели — браузерная точка входа, main — серверная', async () => {
    const project = await loadProject(await copyProject('commands-panel'));
    expect(project.browserEntries).toEqual([
      { source: 'src/panel.ts', output: 'panel.mjs' },
    ]);
    expect(project.nodeEntries.map((entry) => entry.output)).toContain(
      'main.mjs',
    );
  });
});

describe('панели и команды: сборка', () => {
  it('собирает panel.mjs и main.mjs, validate проходит', async () => {
    const root = await projectWithSdk();
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs', 'panel.mjs']);
    expect(await readFile(path.join(dir, 'panel.mjs'), 'utf8')).toContain(
      'mount',
    );
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('нет src/panel.ts — ошибка называет файл', async () => {
    const root = await projectWithSdk();
    await rm(path.join(root, 'src', 'panel.ts'));
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain('src/panel.ts');
  });

  it('module ./ui/screen.js собирается в ui/screen.js из src/screen.ts', async () => {
    const root = await projectWithSdk();
    await editManifest(root, (manifest) => {
      const [first] = manifest.contributes.panels ?? [];
      if (first !== undefined) first.module = './ui/screen.js';
    });
    await rename(
      path.join(root, 'src', 'panel.ts'),
      path.join(root, 'src', 'screen.ts'),
    );
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs', 'ui/screen.js']);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('команды требуют код: без main.mjs validate падает', async () => {
    const root = await projectWithSdk();
    const { dir } = await buildExtension({ root });
    await rm(path.join(dir, 'main.mjs'));
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain('main.mjs');
  });

  it('без панелей panel.mjs не собирается', async () => {
    const root = await projectWithSdk();
    await editManifest(root, (manifest) => {
      delete manifest.contributes.panels;
    });
    const { files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs']);
  });
});
