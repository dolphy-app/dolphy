// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'tsdown';
import { describe, expect, it } from 'vitest';

const LIMIT_BYTES = 10 * 1024;
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));

describe('bundle size', () => {
  it('the whole package stays within 10 KiB gzip, unminified as published', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dolphy-ui-size-'));
    try {
      await build({
        config: false,
        cwd: PACKAGE,
        entry: { index: join(PACKAGE, 'src/index.ts') },
        outDir: out,
        format: 'esm',
        platform: 'neutral',
        dts: false,
        minify: false,
        sourcemap: false,
        logLevel: 'silent',
        report: false,
        publint: false,
        attw: false,
      });
      const code = await readFile(join(out, 'index.js'));
      const size = gzipSync(code, { level: 9 }).length;
      expect(size).toBeGreaterThan(1000);
      expect(size).toBeLessThanOrEqual(LIMIT_BYTES);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 60_000);
});
