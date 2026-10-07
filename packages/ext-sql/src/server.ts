import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqlVerifier, isSafePath } from '@dolphy-app/engine-sql-runner';
import { defineExerciseType, defineServer } from '@dolphy-app/extension-sdk';
import { answerSchema, specSchema } from './schema.ts';

interface SqlSpec {
  reference?: unknown;
}

// в собранном каталоге рядом лежит `worker.mjs`; при запуске из исходников
// (тесты) — `worker.ts`, который Node исполняет через type stripping
const resolveWorkerPath = (): string => {
  const bundled = fileURLToPath(
    new URL(/* @vite-ignore */ './worker.mjs', import.meta.url),
  );
  return existsSync(bundled)
    ? bundled
    : fileURLToPath(new URL(/* @vite-ignore */ './worker.ts', import.meta.url));
};

export const server = defineServer((s) => {
  const verifier = createSqlVerifier({
    source: s.library,
    logger: s.logger,
    workerPath: resolveWorkerPath(),
    // внутри Electron `process.execPath` — бинарь приложения: без
    // ELECTRON_RUN_AS_NODE он запустил бы приложение, а не Node
    spawnWorker: (modulePath, args, options) =>
      fork(modulePath, args, {
        ...options,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }),
  });

  const readReference = async (reference: string) => {
    if (!isSafePath(reference)) throw new Error('reference path is not safe');
    return (await s.library.readText(reference)).trim();
  };

  s.registerExerciseType(
    defineExerciseType<SqlSpec, string, Record<string, never>>({
      id: 'dolphy.sql',
      title: { en: 'SQL query', ru: 'SQL-запрос' },
      specSchema,
      answerSchema,
      project: () => ({}),
      grade: ({ spec, answer, timeoutMs, authorMode }) =>
        verifier.check({ spec, answer, timeoutMs, authorMode }),
      referenceAnswer: ({ spec }) =>
        typeof spec.reference === 'string'
          ? readReference(spec.reference)
          : undefined,
    }),
  );

  return () => verifier.close();
});
