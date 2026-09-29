/**
 * Хеши golden-fixtures планировщика: fixture меняется только регенерацией
 * через `golden-rs` вместе с записью в `golden/MANIFEST.json`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readGoldenBytes } from './helpers/golden.ts';

interface Manifest {
  fixtures: Record<string, { cases: number; sha256: string }>;
}

const manifest = JSON.parse(
  readGoldenBytes('MANIFEST.json').toString('utf8'),
) as Manifest;

describe('golden fixtures планировщика соответствуют MANIFEST.json', () => {
  it.each(Object.entries(manifest.fixtures))(
    '%s',
    (name, { cases, sha256 }) => {
      const content = readGoldenBytes(name);
      expect(createHash('sha256').update(content).digest('hex')).toBe(sha256);
      const lines = content.toString('utf8').split('\n').filter(Boolean);
      // заголовок + по строке на кейс
      expect(lines).toHaveLength(cases + 1);
    },
  );
});
