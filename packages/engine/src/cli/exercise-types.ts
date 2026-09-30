/**
 * Верификаторы для `engine-cli --run-checks`. Ядро от `@lms/engine-sql-runner`
 * не зависит (раннер зависит от `@lms/engine`): пакет подгружается динамически
 * по имени, тип — локальный. Так `--run-checks` работает в монорепозитории,
 * а сборка ядра не тянет нативные зависимости раннера.
 */
import type { CourseSource, Logger, Verifier } from '../ports/index.ts';

export interface CliVerifiers {
  verifiers: readonly Verifier[];
  close(): Promise<void>;
}

export type CreateVerifiers = (
  source: CourseSource,
  logger: Logger,
) => Promise<CliVerifiers>;

interface SqlRunnerModule {
  createSqlVerifier(options: {
    source: CourseSource;
    logger: Logger;
  }): Verifier & { warm(): Promise<void> };
}

/** Имя в переменной: без литерала `tsc` не пытается разрешить пакет в этот проект. */
const SQL_RUNNER_PACKAGE = '@lms/engine-sql-runner';

export class VerifiersUnavailableError extends Error {}

export const loadSqlRunnerVerifiers: CreateVerifiers = async (
  source,
  logger,
) => {
  let module: SqlRunnerModule;
  try {
    module = (await import(SQL_RUNNER_PACKAGE)) as SqlRunnerModule;
  } catch (error) {
    throw new VerifiersUnavailableError(
      `--run-checks требует пакет ${SQL_RUNNER_PACKAGE}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const verifier = module.createSqlVerifier({ source, logger });
  return { verifiers: [verifier], close: () => verifier.close() };
};
