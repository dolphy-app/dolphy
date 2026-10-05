/**
 * `engine-cli validate --run-checks` с настоящим расширением `dolphy.js`:
 * эталон `reference` проходит проверку, неверный даёт `E_REFERENCE_FAILS`.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreateExerciseTypes } from '../../engine/src/cli/exercise-types.ts';
import { runCli } from '../../engine/src/cli/run.ts';
import { createJsExerciseTypes, extensionRoot } from './helpers-extension.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const exercise = (reference: string) => `---
engine:
  exercise:
    type: dolphy.js
    timeoutMs: 2000
    spec:
      starter: |
        function double(n) {}
      tests: |
        test('double(2) === 4', () => assert.equal(double(2), 4));
        test('double(0) === 0', () => assert.equal(double(0), 0));
      reference: |
        ${reference}
  tags: [functions]
  bloom: apply
  dok: 2
---

Write \`double(n)\`: it returns twice the number.
`;

const createLibrary = async (reference: string): Promise<string> => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'ext-js-cli-')));
  dirs.push(dir);
  const course = join(dir, 'js_kb');
  const lesson = join(course, 'basics.lesson');
  await mkdir(lesson, { recursive: true });
  const write = (file: string, text: string) => writeFile(file, text);
  await write(
    join(course, 'course_manifest.json'),
    JSON.stringify({
      dependencies: [],
      description: 'JS course',
      engine: { requiresChecks: true, tags: ['js'] },
      generator_config: { KnowledgeBase: {} },
      id: 'js_kb',
      name: 'JS',
    }),
  );
  await write(join(lesson, 'lesson.name.json'), '"Basics"');
  await write(join(lesson, 'lesson.dependencies.json'), '[]');
  await write(join(lesson, 'lesson.material.md'), '# Basics\n');
  await write(join(lesson, 'q1.name.json'), '"double"');
  await write(join(lesson, 'q1.front.md'), exercise(reference));
  return dir;
};

const cli = async (dir: string) => {
  let stdout = '';
  const createExerciseTypes: CreateExerciseTypes = async () => {
    const exerciseTypes = await createJsExerciseTypes(dir);
    return { exerciseTypes, close: () => exerciseTypes.close() };
  };
  const code = await runCli(
    ['validate', dir, '--run-checks', '--extensions', await extensionRoot()],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
    },
    { createExerciseTypes },
  );
  return { code, stdout };
};

describe('engine-cli --run-checks с расширением dolphy.js', () => {
  it('верный reference проходит, код 0', async () => {
    const { code, stdout } = await cli(
      await createLibrary('function double(n) { return n * 2; }'),
    );
    expect(stdout).toContain(
      'reference solutions: 1 checked, 0 failed, 0 skipped',
    );
    expect(code, stdout).toBe(0);
  });

  it('неверный reference: E_REFERENCE_FAILS, код 1', async () => {
    const { code, stdout } = await cli(
      await createLibrary('function double(n) { return n + 1; }'),
    );
    expect(code).toBe(1);
    expect(stdout).toContain('E_REFERENCE_FAILS');
    expect(stdout).toContain('js_kb::basics::q1');
  });
});
