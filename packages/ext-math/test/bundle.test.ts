import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '@spirula-app/extension-tools';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const out: string[] = [];

afterAll(async () => {
  await Promise.all(
    out.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('сборка spirula.math', () => {
  it('бандл не импортирует модули по сети', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'spirula-math-'));
    out.push(outDir);
    const { dir } = await buildExtension({ root, outDir });
    const code = await readFile(join(dir, 'markdown.mjs'), 'utf8');
    expect(code).not.toMatch(/\bfrom\s*["']https?:/);
    expect(code).not.toMatch(/\bimport\s*\(\s*["']https?:/);
    expect(code).not.toMatch(/\bimport\s*["']https?:/);
  }, 60_000);
});
