import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderProject } from '../src/index.ts';
import { REPO_ROOT } from './helpers.ts';

const HEADING = '## Как написать расширение';
const EXAMPLE_ID = 'acme.hello';

const sectionOf = (doc: string): string => {
  const start = doc.indexOf(`\n${HEADING}\n`);
  if (start === -1) throw new Error(`no section '${HEADING}'`);
  const rest = doc.slice(start + 1);
  const next = rest.indexOf('\n## ', HEADING.length);
  return next === -1 ? rest : rest.slice(0, next);
};

describe('docs/design/extensions.md', () => {
  it.each([
    ['extension.json', 'json'],
    ['src/index.ts', 'ts'],
  ])(
    'раздел содержит %s байт в байт, как его генерирует шаблон',
    async (file, lang) => {
      const doc = await readFile(
        path.join(REPO_ROOT, 'docs/design/extensions.md'),
        'utf8',
      );
      const project = renderProject({
        id: EXAMPLE_ID,
        dependencies: { sdk: '^0.0.0', tools: '^0.0.0' },
      });
      const content = project.get(file);
      expect(content).toBeDefined();
      expect(sectionOf(doc)).toContain(`\`\`\`${lang}\n${content}\`\`\``);
    },
  );
});
