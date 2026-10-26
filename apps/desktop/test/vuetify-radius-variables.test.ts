import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SETTINGS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/app/styles/vuetify-settings.scss',
);

/** Переменные компонентов Vuetify, равные `$border-radius-root`. */
const vuetifyRadiusVariables = (): string[] => {
  const lib = join(
    dirname(createRequire(import.meta.url).resolve('vuetify/package.json')),
    'lib/components',
  );
  const found = new Set<string>();
  for (const component of readdirSync(lib, { withFileTypes: true })) {
    if (!component.isDirectory()) continue;
    let text: string;
    try {
      text = readFileSync(join(lib, component.name, '_variables.scss'), 'utf8');
    } catch {
      continue;
    }
    for (const [, name] of text.matchAll(
      /^\$([a-z0-9-]+):\s*settings\.\$border-radius-root\s*!default;/gm,
    )) {
      found.add(name as string);
    }
  }
  return [...found].sort();
};

/** Переменные, которые наш `vuetify-settings.scss` подключает к токену скругления. */
const wiredVariables = (): string[] =>
  [
    ...readFileSync(SETTINGS, 'utf8').matchAll(
      /^ {2}\$([a-z0-9-]+-radius):\s*\$md,?$/gm,
    ),
  ]
    .map(([, name]) => name as string)
    .sort();

describe('скругления Vuetify и токены темы', () => {
  it('каждая переменная компонента, равная базовому радиусу, подключена к токену radius-md', () => {
    const vuetify = vuetifyRadiusVariables();
    expect(vuetify.length).toBeGreaterThan(20);
    expect(wiredVariables()).toEqual(vuetify);
  });
});
