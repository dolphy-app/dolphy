import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExtension, validateExtension } from '../src/index.ts';
import { copyProject } from './helpers.ts';

describe('dolphy-ext build: widgets', () => {
  it('widget.mjs takes vue and vuetify from the window and stays small', async () => {
    const root = await copyProject('widget-host');
    const { dir, files } = await buildExtension({
      root,
      outDir: path.join(root, 'out'),
    });
    expect(files).toEqual(['extension.json', 'widget.mjs']);
    const code = await readFile(path.join(dir, 'widget.mjs'), 'utf8');
    expect(code).toContain('WIDGET_ALERT');
    expect(code).toContain('globalThis.__dolphy.require("vue")');
    expect(code).toContain('globalThis.__dolphy.require("vuetify/components")');
    expect(code).not.toMatch(/from\s*["'](vue|vuetify)/);
    expect(code).not.toContain('createVNode');
    expect(code).not.toContain('vuetify/styles');
    expect(Buffer.byteLength(code)).toBeLessThan(5 * 1024);
    expect(await validateExtension(dir)).toEqual({
      ok: true,
      problems: [],
      warnings: [],
    });
  });
});
