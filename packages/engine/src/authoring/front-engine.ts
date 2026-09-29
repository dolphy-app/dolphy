/**
 * Блок `engine` из YAML-frontmatter front-файла упражнения. Общий для
 * JSON-раскладки (`front_path`) и KB (`<id>.front.md`).
 */
import type { EngineExtension } from '../domain/manifest.ts';
import { diag } from './diagnostics.ts';
import { checkEngine } from './engine-schema.ts';
import type { FileReader } from './file-reader.ts';
import { FrontYamlError, parseFrontmatterYaml } from './front-yaml.ts';
import { splitFrontmatter } from './frontmatter.ts';
import type { Src } from './model.ts';

export interface FrontEngine {
  engine?: EngineExtension;
  engineSrc?: Src;
  /** Файл содержит ошибку frontmatter (разбор или схема `engine`). */
  failed: boolean;
}

const CHAR_DASH = 0x2d;
const CHAR_BOM = 0xfeff;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findLine = (lines: string[], pattern: RegExp, from: number) => {
  for (let i = from; i < lines.length; i++) {
    if (pattern.test(lines[i] as string)) return i;
  }
  return null;
};

/**
 * Читает frontmatter `text` файла `path`: `W_UNKNOWN_KEY` на ключи кроме
 * `engine`, `E_FRONTMATTER_*`, `E_ENGINE_SCHEMA`, `W_ENGINE_UNKNOWN_KEY`.
 */
export const readFrontEngine = async (
  reader: FileReader,
  path: string,
  text: string,
  unitId: string,
): Promise<FrontEngine> => {
  const { diagnostics } = reader;
  const first = text.charCodeAt(0);
  if (first !== CHAR_DASH && first !== CHAR_BOM) return { failed: false };
  const split = splitFrontmatter(text);
  if (split.unterminated) {
    diagnostics.push(
      diag(
        'E_FRONTMATTER_UNTERMINATED',
        'frontmatter fence `---` is opened but never closed; the whole file is treated as text',
        { path, line: 1, unitId },
      ),
    );
    return { failed: true };
  }
  if (split.front === null) return { failed: false };
  reader.stats.frontFiles++;

  // строка в тексте блока (0-based) -> строка файла
  const fileLine = (index: number | null) =>
    index === null ? split.frontStartLine : split.frontStartLine + index;
  let doc: unknown;
  try {
    doc = await parseFrontmatterYaml(split.front);
  } catch (error) {
    const line =
      error instanceof FrontYamlError
        ? split.frontStartLine - 1 + error.line
        : split.frontStartLine;
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push(
      diag('E_FRONTMATTER_PARSE', `frontmatter: ${message}`, {
        path,
        line,
        unitId,
      }),
    );
    return { failed: true };
  }
  if (doc === null) return { failed: false };
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    diagnostics.push(
      diag('E_FRONTMATTER_PARSE', 'frontmatter must be a mapping', {
        path,
        line: split.frontStartLine,
        unitId,
      }),
    );
    return { failed: true };
  }
  const mapping = doc as Record<string, unknown>;

  const lines = split.front.split('\n');
  for (const key of Object.keys(mapping)) {
    if (key === 'engine') continue;
    const pattern = new RegExp(`^["']?${escapeRegExp(key)}["']?\\s*:`);
    diagnostics.push(
      diag(
        'W_UNKNOWN_KEY',
        `unknown frontmatter key '${key}' (only 'engine' is interpreted)`,
        { path, line: fileLine(findLine(lines, pattern, 0)), unitId },
      ),
    );
  }
  if (!('engine' in mapping)) return { failed: false };

  const engineIndex = findLine(lines, /^["']?engine["']?\s*:/, 0);
  const engineSrc: Src = { path, line: fileLine(engineIndex) };
  const lineFor = (key: string) => {
    if (engineIndex === null) return null;
    const pattern = new RegExp(`^\\s+["']?${escapeRegExp(key)}["']?\\s*:`);
    const index = findLine(lines, pattern, engineIndex + 1);
    return index === null ? null : fileLine(index);
  };
  const engine = checkEngine(
    mapping.engine,
    'exercise',
    { ...engineSrc, unitId },
    diagnostics,
    lineFor,
  );
  return engine === null
    ? { failed: true }
    : { engine, engineSrc, failed: false };
};
