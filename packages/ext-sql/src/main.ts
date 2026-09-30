import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqlVerifier, isSafePath } from '@lms/engine-sql-runner';
import type { ExtensionModule } from '@lms/extension-api';

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

let verifier: ReturnType<typeof createSqlVerifier> | undefined;

const module: ExtensionModule = {
  activate(context) {
    const active = createSqlVerifier({
      source: context.library,
      logger: context.logger,
      workerPath: resolveWorkerPath(),
      // внутри Electron `process.execPath` — бинарь приложения: без
      // ELECTRON_RUN_AS_NODE он запустил бы приложение, а не Node
      spawnWorker: (modulePath, args, options) =>
        fork(modulePath, args, {
          ...options,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        }),
    });
    verifier = active;
    context.registerExerciseType('lms.sql', {
      project: () => ({}),
      grade: ({ spec, answer, timeoutMs, authorMode }) =>
        active.check({ spec, answer, timeoutMs, authorMode }),
      referenceAnswer: async ({ spec }) => {
        const reference = (spec as { reference?: unknown }).reference;
        if (typeof reference === 'string' && !isSafePath(reference)) {
          throw new Error('reference path is not safe');
        }
        return typeof reference === 'string'
          ? (await context.library.readText(reference)).trim()
          : undefined;
      },
    });
  },
  async deactivate() {
    await verifier?.close();
    verifier = undefined;
  },
};

export default module;
