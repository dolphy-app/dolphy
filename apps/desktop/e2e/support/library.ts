import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEEDED_LIBRARY_SOURCES } from './app.ts';

const SQL_LIBRARY = SEEDED_LIBRARY_SOURCES[0] as string;

/**
 * Эталонные решения упражнений урока SQL-курса: первая строка формулировки
 * (как её показывает интерфейс, без разметки) → текст `reference` из
 * frontmatter упражнения.
 */
export const sqlReferenceSolutions = (lesson: string): Map<string, string> => {
  const solutions = new Map<string, string>();
  for (const exercise of ['q1', 'q2', 'q3']) {
    const source = readFileSync(
      join(SQL_LIBRARY, 'sql_kb', lesson, `${exercise}.front.md`),
      'utf8',
    );
    const [, frontmatter = '', body = ''] = source.split(/^---$/m);
    const reference = frontmatter.match(/reference: (.+)/)?.[1]?.trim();
    if (!reference) throw new Error(`no reference in ${lesson}/${exercise}`);
    const prompt = body.trim().split('\n')[0]?.replaceAll('`', '') ?? '';
    solutions.set(prompt, readFileSync(join(SQL_LIBRARY, reference), 'utf8'));
  }
  return solutions;
};
