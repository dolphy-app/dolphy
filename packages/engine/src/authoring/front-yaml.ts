/**
 * Единственное место импорта `yaml`: динамический `import()`, чтобы холодный
 * старт без компиляции пакет не загружал (engine-ts-electron.md §2).
 */

import type { parse as yamlParse } from 'yaml';

export type YamlValue =
  null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

/** Ошибка разбора YAML с номером строки внутри блока (1-based). */
export class FrontYamlError extends Error {
  /** Строка внутри переданного текста, 1-based; `1`, если неизвестна. */
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'FrontYamlError';
    this.line = line;
  }
}

let yamlModule: Promise<{ parse: typeof yamlParse }> | undefined;
const loadYaml = () => (yamlModule ??= import('yaml'));

const OPTIONS = {
  schema: 'core',
  version: '1.2',
  uniqueKeys: true,
  strict: true,
  maxAliasCount: 0,
} as const;

/** Разбор YAML frontmatter: только ядро YAML 1.2, без псевдонимов. */
export const parseFrontmatterYaml = async (
  text: string,
): Promise<YamlValue> => {
  const yaml = await loadYaml();
  try {
    return yaml.parse(text, OPTIONS) as YamlValue;
  } catch (error) {
    const cause = error as Error & { linePos?: { line: number }[] };
    const line = cause.linePos?.[0]?.line ?? 1;
    const first = (cause.message ?? String(error)).split('\n')[0] ?? '';
    throw new FrontYamlError(first, line);
  }
};
