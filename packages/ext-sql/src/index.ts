import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqlVerifier, isSafePath } from '@dolphy-app/engine-sql-runner';
import {
  defineAnswerView,
  defineExerciseType,
  defineExtension,
} from '@dolphy-app/extension-sdk';
import type {
  ExtensionContext,
  ExtensionViews,
} from '@dolphy-app/extension-sdk';
import { mountSqlEditor } from './sql-view.ts';

interface SqlSpec {
  reference?: unknown;
}

type SqlVerifier = ReturnType<typeof createSqlVerifier>;

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

// обработчики регистрируются до `activate`, раннер создаётся в нём
const holder: {
  verifier?: SqlVerifier;
  library?: ExtensionContext['library'];
} = {};

const requireVerifier = (): SqlVerifier => {
  if (holder.verifier === undefined) {
    throw new Error('dolphy.sql extension is not activated');
  }
  return holder.verifier;
};

const readReference = async (reference: string) => {
  if (!isSafePath(reference)) throw new Error('reference path is not safe');
  const { library } = holder;
  if (library === undefined) {
    throw new Error('dolphy.sql extension is not activated');
  }
  return (await library.readText(reference)).trim();
};

export const host = defineExtension({
  exerciseTypes: {
    'dolphy.sql': defineExerciseType<SqlSpec, string, Record<string, never>>({
      project: () => ({}),
      grade: ({ spec, answer, timeoutMs, authorMode }) =>
        requireVerifier().check({ spec, answer, timeoutMs, authorMode }),
      referenceAnswer: ({ spec }) =>
        typeof spec.reference === 'string'
          ? readReference(spec.reference)
          : undefined,
    }),
  },
  activate(context) {
    holder.library = context.library;
    holder.verifier = createSqlVerifier({
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
  },
  async deactivate() {
    const { verifier } = holder;
    delete holder.verifier;
    delete holder.library;
    await verifier?.close();
  },
});

export const views = {
  'dolphy.sql': defineAnswerView(mountSqlEditor),
} satisfies ExtensionViews;
