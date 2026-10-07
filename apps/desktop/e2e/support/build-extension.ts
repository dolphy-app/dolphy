import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../../../../packages/extension-tools/src/index.ts';

const PACKAGES = fileURLToPath(
  new URL('../../../../packages', import.meta.url),
);
const APP_MODULES = fileURLToPath(
  new URL('../../node_modules', import.meta.url),
);

/** Workspace packages an author's project finds in `node_modules` (the SDK for the entry). */
const LINKED = ['extension-sdk'] as const;

/** What an author lists as dependencies: the build resolves Vue and Vuetify for types and tree shaking, then the app's own instances replace them. */
const AUTHOR_DEPENDENCIES = ['vue', 'vuetify'] as const;

export interface BuiltExtension {
  /** The built extension (`<out>/<id>`), ready for `createWorkspace({ extensions })`. */
  dir: string;
  dispose(): Promise<void>;
}

/**
 * Builds the source project `fixture` (`extension.json` and `src/index.ts`) with `dolphy-ext build`,
 * as an author would: Vue and Vuetify of every browser file come from the app
 * (`hostModulesPlugin`). The project is built from a temporary copy that
 * has the SDK linked into its `node_modules`; the repository stays clean.
 */
export const buildFixtureExtension = async (
  fixture: string,
): Promise<BuiltExtension> => {
  const root = await mkdtemp(join(tmpdir(), 'dolphy-e2e-build-'));
  try {
    const project = join(root, 'project');
    await cp(fixture, project, { recursive: true });
    for (const name of LINKED) {
      const link = join(project, 'node_modules', '@dolphy-app', name);
      await mkdir(dirname(link), { recursive: true });
      await symlink(join(PACKAGES, name), link);
    }
    for (const name of AUTHOR_DEPENDENCIES) {
      await symlink(
        await realpath(join(APP_MODULES, name)),
        join(project, 'node_modules', name),
      );
    }
    const out = join(root, 'out');
    const { dir } = await buildExtension({ root: project, outDir: out });
    return { dir, dispose: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
};
