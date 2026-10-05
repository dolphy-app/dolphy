import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from '../src/pages/settings/i18n/en.ts';
import { ru } from '../src/pages/settings/i18n/ru.ts';

const GUIDE = fileURLToPath(
  new URL('../../../packages/extension-sdk/docs/debugging.md', import.meta.url),
);

/** Rows `| where | English | Русский | `key` |` of the guide's label table. */
const labelRows = () =>
  readFileSync(GUIDE, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      const key = /^`(settings\.[\w.]+)`$/.exec(cells[3] ?? '')?.[1];
      return key === undefined
        ? []
        : [{ where: cells[0] as string, key, en: cells[1], ru: cells[2] }];
    });

const lookup = (messages: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? Reflect.get(node, part)
          : undefined,
      messages,
    );

describe('debugging guide (R15)', () => {
  const rows = labelRows();

  it('names the labels of the log window and the settings it sends you to', () => {
    expect(rows.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        'settings.extensions.support.openLog',
        'settings.extensions.log.rowAction',
        'settings.extensions.log.filterExtension',
        'settings.extensions.log.filterLevel',
        'settings.extensions.log.refresh',
        'settings.extensions.origin.dev',
        'settings.extensions.trustLabel',
      ]),
    );
  });

  it.each(rows.map((row) => [row.key, row] as const))(
    '%s: the quoted labels are the app messages',
    (_key, row) => {
      expect(lookup({ settings: en.settings }, row.key), 'en').toBe(row.en);
      expect(lookup({ settings: ru.settings }, row.key), 'ru').toBe(row.ru);
    },
  );
});
