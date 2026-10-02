import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildError, buildExtension, validateExtension } from '../src/index.ts';
import { loadProject } from '../src/project.ts';
import { copyProject } from './helpers.ts';

const projectWithSdk = (): Promise<string> => copyProject('commands-panel');

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

describe('panels and commands: project', () => {
  it('the panel module is the browser entry point, main is the server one', async () => {
    const project = await loadProject(await copyProject('commands-panel'));
    expect(project.browserOutputs).toEqual([
      {
        kind: 'browser',
        output: 'panel.mjs',
        views: [],
        panels: ['acme.commands-panel.main'],
        languages: [],
      },
    ]);
    expect(project.host).toEqual({ kind: 'host', output: 'main.mjs' });
  });
});

describe('panels and commands: build', () => {
  it('builds panel.mjs and main.mjs, validate passes', async () => {
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

  it('no src/index.ts — the error names the file', async () => {
    const root = await projectWithSdk();
    await rm(path.join(root, 'src', 'index.ts'));
    const error = await buildExtension({ root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).message).toContain("'src/index.ts'");
  });

  it('module ./ui/screen.js is built into ui/screen.js from the panels export', async () => {
    const root = await projectWithSdk();
    await editManifest(root, (manifest) => {
      const [first] = manifest.contributes.panels ?? [];
      if (first !== undefined) first.module = './ui/screen.js';
    });
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs', 'ui/screen.js']);
    expect(await validateExtension(dir)).toEqual({ ok: true, problems: [] });
  });

  it('commands require code: without main.mjs validate fails', async () => {
    const root = await projectWithSdk();
    const { dir } = await buildExtension({ root });
    await rm(path.join(dir, 'main.mjs'));
    const result = await validateExtension(dir);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain('main.mjs');
  });

  it('without panels panel.mjs is not built', async () => {
    const root = await projectWithSdk();
    await editManifest(root, (manifest) => {
      delete manifest.contributes.panels;
    });
    await writeFile(
      path.join(root, 'src', 'index.ts'),
      (await readFile(path.join(root, 'src', 'index.ts'), 'utf8')).replace(
        /\nexport const panels[\s\S]*$/,
        '',
      ),
    );
    const { files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'main.mjs']);
  });

  it('a panel removed from the manifest but left in the code’s panels — the error names the entry', async () => {
    const root = await projectWithSdk();
    await editManifest(root, (manifest) => {
      delete manifest.contributes.panels;
    });
    await expect(buildExtension({ root })).rejects.toThrow(
      "'panels' has entry 'acme.commands-panel.main'",
    );
  });
});
