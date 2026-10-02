import { readFile, writeFile } from 'node:fs/promises';
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
  it('T-20 правка src/index.ts пересобирает затронутые файлы и пишет в журнал одну строку', async () => {
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

  it('ошибка в src/index.ts называет файлы и пишется один раз; исправление пересобирает', async () => {
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

  it('правка extension.json пересобирает файлы по новому манифесту', async () => {
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
      // код ещё не знает о панели: ошибка называет запись, вотчеры ждут правки
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
});
