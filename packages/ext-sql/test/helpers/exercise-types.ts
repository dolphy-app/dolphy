import { cp, mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeFsCourseSource } from '@dolphy-app/engine/node';
import type { ExerciseTypes } from '@dolphy-app/engine/ports';
import { discoverExtensions } from '@dolphy-app/extension-host';
import { createLocalExerciseTypes } from '@dolphy-app/extension-host/local';
import { silentLogger } from '@dolphy-app/testkit';
import { host } from '../../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

let rootPromise: Promise<string> | null = null;

/**
 * Корень обнаружения `<tmp>/dolphy.sql/{extension.json,schema}` из исходников
 * пакета (без сборки); один на процесс, удаляется при выходе.
 */
export const extensionRoot = (): Promise<string> => {
  rootPromise ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), 'ext-sql-root-'));
    process.on('exit', () => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'dolphy.sql');
    await cp(join(PACKAGE_DIR, 'extension.json'), join(dir, 'extension.json'));
    await cp(join(PACKAGE_DIR, 'schema'), join(dir, 'schema'), {
      recursive: true,
    });
    return root;
  })();
  return rootPromise;
};

/** Настоящее расширение `dolphy.sql` (исходники) поверх библиотеки `libraryDir`. */
export const createSqlExerciseTypes = async (
  libraryDir: string,
): Promise<ExerciseTypes> => {
  const { extensions, diagnostics } = await discoverExtensions({
    roots: [{ dir: await extensionRoot(), origin: 'bundled' }],
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
    modules: { 'dolphy.sql': host },
  });
};
