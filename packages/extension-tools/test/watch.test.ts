import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchExtension } from '../src/index.ts';
import type { BuildLogger } from '../src/index.ts';
import { copyProject, waitFor } from './helpers.ts';

const settle = (ms = 700): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const recordLogger = () => {
  const info: string[] = [];
  const error: string[] = [];
  const logger: BuildLogger = {
    info: (message) => void info.push(message),
    error: (message) => void error.push(message),
  };
  return { logger, info, error };
};

const edit = async (
  file: string,
  change: (text: string) => string,
): Promise<void> => {
  await writeFile(file, change(await readFile(file, 'utf8')));
};

const read = (dir: string, file: string): Promise<string> =>
  readFile(path.join(dir, file), 'utf8');

describe('watchExtension', () => {
  it('T-20 editing src/index.ts rebuilds affected files and writes one line to the log', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const { dir } = handle.result;
      expect(handle.result.files).toEqual([
        'extension.json',
        'main.mjs',
        'view.mjs',
      ]);
      expect(await read(dir, 'main.mjs')).not.toContain('watch-host');
      const index = path.join(root, 'src', 'index.ts');
      await edit(index, (text) =>
        text
          .replace('project: () => ({})', "project: () => 'watch-host'")
          .replace(
            'update() {}',
            "update() { document.title = 'watch-view'; }",
          ),
      );
      await waitFor(
        async () =>
          (await read(dir, 'main.mjs')).includes('watch-host') &&
          (await read(dir, 'view.mjs')).includes('watch-view'),
      );
      await settle();
      expect(log.error).toEqual([]);
      expect(log.info).toHaveLength(1);
      expect(log.info[0]).toMatch(
        /^rebuilt (main\.mjs, view\.mjs|view\.mjs, main\.mjs)$/,
      );
    } finally {
      await handle.close();
    }
  });

  it('an error in src/index.ts names the files and is logged once; a fix rebuilds', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const index = path.join(root, 'src', 'index.ts');
      const good = await readFile(index, 'utf8');
      await writeFile(
        index,
        good.replace(
          "'acme.hello': defineAnswerView",
          "'acme.extra': defineAnswerView",
        ),
      );
      await waitFor(async () => log.error.length > 0);
      await settle();
      expect(log.error).toHaveLength(1);
      expect(log.error[0]).toContain('acme.hello');
      expect(log.error[0]).toContain('acme.extra');
      expect(log.error[0]).toContain('main.mjs (host');
      expect(log.error[0]).toContain('view.mjs (views');

      log.info.length = 0;
      await writeFile(
        index,
        good.replace('update() {}', 'update() { /* fixed */ }'),
      );
      await waitFor(async () => log.info.length > 0);
      await settle(300);
      expect(log.info).toHaveLength(1);
      expect(log.error).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('editing extension.json rebuilds files per the new manifest', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      const { dir } = handle.result;
      const manifestFile = path.join(root, 'extension.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
        contributes: Record<string, unknown>;
      };
      manifest.contributes.panels = [
        { id: 'acme.hello.panel', title: 'Hello' },
      ];
      await writeFile(manifestFile, JSON.stringify(manifest));
      // the code does not know about the panel yet: the error names the entry, watchers wait for an edit
      await waitFor(async () =>
        log.error.some((message) => message.includes('acme.hello.panel')),
      );
      await edit(path.join(root, 'src', 'index.ts'), (text) =>
        text
          .replace(
            'import { defineAnswerView, defineExtension }',
            'import { defineAnswerView, defineExtension, defineExtensionPanel }',
          )
          .concat(
            "\nexport const panels = { 'acme.hello.panel': defineExtensionPanel({ mount(container) { container.textContent = 'hello panel'; } }) };\n",
          ),
      );
      await waitFor(async () => {
        try {
          return (await read(dir, 'panel.mjs')).includes('hello panel');
        } catch {
          return false;
        }
      });
      expect(await read(dir, 'extension.json')).toContain('acme.hello.panel');
    } finally {
      await handle.close();
    }
  });

  it('editing extension.json regenerates .dolphy/ids.d.ts; an edit without an id change and a code edit leave it alone', async () => {
    const root = await copyProject('hello');
    const log = recordLogger();
    const idsFile = path.join(root, '.dolphy', 'ids.d.ts');
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
      logger: log.logger,
    });
    try {
      expect(await readFile(idsFile, 'utf8')).toContain('commands: never');
      const manifestFile = path.join(root, 'extension.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
        contributes: Record<string, unknown>;
      };
      manifest.contributes.commands = [{ id: 'acme.hello.run', title: 'Run' }];
      await writeFile(manifestFile, JSON.stringify(manifest));
      await waitFor(async () =>
        (await readFile(idsFile, 'utf8')).includes(
          "commands: 'acme.hello.run'",
        ),
      );

      // the same ids in a differently formatted manifest, and a source edit:
      // the file keeps its old mtime, so a watcher on the project sees nothing
      const old = new Date('2020-01-01T00:00:00Z');
      await utimes(idsFile, old, old);
      await writeFile(manifestFile, JSON.stringify(manifest, null, 4));
      await edit(path.join(root, 'src', 'index.ts'), (text) => `${text}\n`);
      await settle(1200);
      expect((await stat(idsFile)).mtime).toEqual(old);
    } finally {
      await handle.close();
    }
  });
});
