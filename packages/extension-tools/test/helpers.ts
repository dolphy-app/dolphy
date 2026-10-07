import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

const projectsDir = fileURLToPath(
  new URL('./fixtures/projects', import.meta.url),
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

export const makeTemp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dolphy-ext-tools-'));
  tempDirs.push(dir);
  return dir;
};

/** Makes Vue resolvable from a project in a temporary directory (in a real project it sits in node_modules). */
export const linkVue = async (root: string): Promise<void> => {
  const sdk = fileURLToPath(new URL('../../extension-sdk', import.meta.url));
  await mkdir(path.join(root, 'node_modules'), { recursive: true });
  await symlink(
    await realpath(path.join(sdk, 'node_modules', 'vue')),
    path.join(root, 'node_modules', 'vue'),
  );
};

/** Makes `react` and `react-dom` (devDependencies of this package) resolvable from a project in a temporary directory. */
export const linkReact = async (root: string): Promise<void> => {
  const own = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(path.join(root, 'node_modules'), { recursive: true });
  for (const name of ['react', 'react-dom']) {
    await symlink(
      await realpath(path.join(own, 'node_modules', name)),
      path.join(root, 'node_modules', name),
    );
  }
};

/**
 * Copy of a fixture project in a temporary directory (the build does not write to
 * the repository); Vue is resolvable as in an author's project. `isLinked: false` — a copy
 * without `node_modules`, e.g. to put the project into a catalog repository.
 */
export const copyProject = async (
  name: string,
  { isLinked = true }: { isLinked?: boolean } = {},
): Promise<string> => {
  const dir = path.join(await makeTemp(), name);
  await cp(path.join(projectsDir, name), dir, { recursive: true });
  if (isLinked) await linkVue(dir);
  return dir;
};

export const waitFor = async (
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
};

const require = createRequire(import.meta.url);
const tscBin = path.join(
  path.dirname(require.resolve('typescript/package.json')),
  'bin',
  'tsc',
);

/** `tsc --noEmit` in the project: the exit code (1 — diagnostics) and what it printed. */
export const runTsc = (project: string) =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [tscBin, '--noEmit'], {
      cwd: project,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
