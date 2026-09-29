import { readFileSync } from 'node:fs';

/** Каталог golden-fixtures планировщика (`golden-rs`, engine-ts-testing.md §4). */
const GOLDEN_DIR = new URL('../golden/', import.meta.url);

export const readGoldenBytes = (name: string) =>
  readFileSync(new URL(name, GOLDEN_DIR));

/**
 * Читает JSONL-fixture: первая строка — заголовок (`trane`, `nowMs`, …),
 * остальные — по одному кейсу на строку.
 */
export const readGoldenJsonl = <Header extends object, Case extends object>(
  name: string,
): Header & { cases: Case[] } => {
  const [head, ...rest] = readGoldenBytes(name)
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
  return {
    ...(JSON.parse(head as string) as Header),
    cases: rest.map((line) => JSON.parse(line) as Case),
  };
};
