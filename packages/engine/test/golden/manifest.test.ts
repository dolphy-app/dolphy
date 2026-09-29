/**
 * Хеши golden-fixtures (engine-ts-testing.md §4): fixture меняется только
 * регенерацией через `golden-rs` вместе с записью в `MANIFEST.json`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  fixtures: Record<string, { cases: number; sha256: string; header?: boolean }>;
}

const read = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url));
const manifest = JSON.parse(read('MANIFEST.json').toString('utf8')) as Manifest;

describe('golden fixtures match MANIFEST.json', () => {
  it.each(Object.entries(manifest.fixtures))(
    '%s',
    (name, { cases, sha256, header }) => {
      const content = read(name);
      expect(createHash('sha256').update(content).digest('hex')).toBe(sha256);
      const lines = content.toString('utf8').split('\n').filter(Boolean);
      // у fixture с `header: true` первая строка — заголовок, не кейс
      expect(lines).toHaveLength(cases + (header === true ? 1 : 0));
    },
  );
});
