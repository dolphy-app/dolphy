import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchExtension } from '../src/index.ts';
import { copyProject, waitFor } from './helpers.ts';

describe('watchExtension', () => {
  it('T-20 пересобирает бандл после изменения исходника', async () => {
    const root = await copyProject('hello');
    const handle = await watchExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    try {
      expect(handle.result.files).toEqual([
        'extension.json',
        'main.mjs',
        'view.mjs',
      ]);
      const built = path.join(handle.result.dir, 'main.mjs');
      expect(await readFile(built, 'utf8')).not.toContain('watch-marker');
      const source = path.join(root, 'src', 'main.ts');
      await writeFile(
        source,
        `${await readFile(source, 'utf8')}\nexport const marker = 'watch-marker';\n`,
      );
      await waitFor(async () =>
        (await readFile(built, 'utf8')).includes('watch-marker'),
      );
    } finally {
      await handle.close();
    }
  });
});
