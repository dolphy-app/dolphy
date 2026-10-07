import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { manifestJsonSchema } from '../src/manifest.ts';

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const SCHEMA_FILE = path.join(
  repo,
  'packages/extension-api/extension.schema.json',
);

const generated = `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`;
if (process.env.UPDATE_EXTENSION_SCHEMA === '1') {
  writeFileSync(SCHEMA_FILE, generated);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')));

const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8'));

const bundled = (): string[] => {
  const root = path.join(repo, 'packages');
  return readdirSync(root, { withFileTypes: true })
    .filter(({ isDirectory }) => isDirectory)
    .map(({ name }) => path.join(root, name, 'extension.json'))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
};

const minimal = () => ({
  id: 'acme.quiz',
  version: '1.0.0',
  apiVersion: 1,
  main: './main.mjs',
  client: './client.mjs',
});

describe('extension.schema.json', () => {
  it('is up to date with the zod manifest (UPDATE_EXTENSION_SCHEMA=1 regenerates)', () => {
    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(generated);
  });

  it('accepts the manifests of the bundled extensions', () => {
    const files = bundled();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        validate(read(file)),
        `${file}: ${ajv.errorsText(validate.errors)}`,
      ).toBe(true);
    }
  });

  it('accepts $schema', () => {
    const manifest = { ...minimal(), $schema: './extension.schema.json' };
    expect(validate(manifest), ajv.errorsText(validate.errors)).toBe(true);
  });

  it('rejects an unknown top-level key', () => {
    expect(validate(minimal())).toBe(true);
    expect(validate({ ...minimal(), homepage: 'x' })).toBe(false);
  });

  it('rejects contributes: contributions are registered in code', () => {
    expect(validate({ ...minimal(), contributes: {} })).toBe(false);
  });

  it('accepts a manifest without main and client', () => {
    const empty = Object.fromEntries(
      Object.entries(minimal()).filter(
        ([key]) => key !== 'main' && key !== 'client',
      ),
    );
    expect(validate(empty), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...minimal(), main: null, client: null })).toBe(true);
  });
});
