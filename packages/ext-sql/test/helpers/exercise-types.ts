import { fileURLToPath } from 'node:url';
import { createNodeFsCourseSource } from '@lms/engine/node';
import type { ExerciseTypes } from '@lms/engine/ports';
import { discoverExtensions } from '@lms/extension-host';
import { createLocalExerciseTypes } from '@lms/extension-host/local';
import { silentLogger } from '@lms/testkit';
import sqlModule from '../../src/main.ts';

/** Исходные манифесты расширения (без сборки): `<id>/extension.json`. */
export const EXTENSION_SRC = fileURLToPath(
  new URL('../../extension-src', import.meta.url),
);

/** Настоящее расширение `lms.sql` (исходники) поверх библиотеки `libraryDir`. */
export const createSqlExerciseTypes = async (
  libraryDir: string,
): Promise<ExerciseTypes> => {
  const { extensions, diagnostics } = await discoverExtensions({
    roots: [{ dir: EXTENSION_SRC, origin: 'bundled' }],
    logger: silentLogger,
    verifyFiles: false,
  });
  if (diagnostics.length > 0) {
    throw new Error(`extension diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  return createLocalExerciseTypes({
    extensions,
    library: createNodeFsCourseSource(libraryDir),
    logger: silentLogger,
    modules: { 'lms.sql': sqlModule },
  });
};
