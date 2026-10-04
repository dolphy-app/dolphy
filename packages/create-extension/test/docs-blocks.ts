/**
 * Shared by the tests that run documentation and generated projects: the code
 * block collector of a markdown guide and a project in a temporary directory
 * whose toolchain is linked from the repository (no network, no install).
 */
import { spawn } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { renderProject } from '../src/index.ts';
import { REPO_ROOT, makeTemp } from './helpers.ts';

const require = createRequire(import.meta.url);
export const packageDir = (name: string): string =>
  path.dirname(require.resolve(`${name}/package.json`));

/** A code block of a guide that is tied to a file of an example project. */
export interface ExampleFile {
  file: string;
  lang: string;
  content: string;
}

export interface CollectedBlocks {
  /** Label → files of the example, in document order. */
  examples: Map<string, ExampleFile[]>;
  /** `ts`, `json` and `js` blocks with neither a marker nor a fragment comment. */
  unmarked: string[];
}

/** ``File `src/index.ts` (label):`` right before a code block. */
const MARKER = /^File `([^`]+)` \(([^)]+)\):$/;
const FRAGMENT = '<!-- fragment -->';
const CHECKED_LANGUAGES = new Set(['ts', 'json', 'js']);

/**
 * Every `ts`/`json`/`js` block of a guide is either an example file (the line
 * before it is ``File `path` (label):``), or a fragment (`<!-- fragment -->`),
 * or reported in `unmarked`. Other languages (`sh`, `text`) are free.
 */
export const collectBlocks = (markdown: string): CollectedBlocks => {
  const lines = markdown.split('\n');
  const examples = new Map<string, ExampleFile[]>();
  const unmarked: string[] = [];
  let previous = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^```(\w*)$/.exec(line);
    if (fence === null) {
      if (line.trim() !== '') previous = line;
      continue;
    }
    const close = lines.indexOf('```', i + 1);
    if (close === -1) throw new Error(`line ${i + 1}: unterminated code fence`);
    const lang = fence[1] ?? '';
    const marker = MARKER.exec(previous);
    if (CHECKED_LANGUAGES.has(lang) && previous !== FRAGMENT) {
      if (marker === null) {
        unmarked.push(`line ${i + 1}: \`\`\`${lang} block has no marker`);
      } else {
        const [, file = '', label = ''] = marker;
        const files = examples.get(label) ?? [];
        files.push({
          file,
          lang,
          content: `${lines.slice(i + 1, close).join('\n')}\n`,
        });
        examples.set(label, files);
      }
    }
    previous = '';
    i = close;
  }
  return { examples, unmarked };
};

export const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Project node_modules: links to the repository toolchain. */
export const linkToolchain = async (project: string): Promise<void> => {
  const modules = path.join(project, 'node_modules');
  await mkdir(path.join(modules, '@dolphy-app'), { recursive: true });
  await mkdir(path.join(modules, '@types'), { recursive: true });
  const links: [string, string][] = [
    [
      '@dolphy-app/extension-api',
      path.join(REPO_ROOT, 'packages/extension-api'),
    ],
    [
      '@dolphy-app/extension-sdk',
      path.join(REPO_ROOT, 'packages/extension-sdk'),
    ],
    [
      '@dolphy-app/extension-tools',
      path.join(REPO_ROOT, 'packages/extension-tools'),
    ],
    ['@types/node', packageDir('@types/node')],
    ['vitest', packageDir('vitest')],
    ['happy-dom', packageDir('happy-dom')],
  ];
  for (const [name, target] of links) {
    await symlink(target, path.join(modules, name), 'dir');
  }
};

export const runNode = (args: string[], cwd: string) =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    // a nested vitest must not consider itself part of the outer run
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith('VITEST') && key !== 'NODE_OPTIONS',
      ),
    );
    const child = spawn(process.execPath, args, { cwd, env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

const tscBin = path.join(packageDir('typescript'), 'bin', 'tsc');
export const tsc = (project: string) => runNode([tscBin, '--noEmit'], project);

const vitestBin = path.join(packageDir('vitest'), 'vitest.mjs');
export const vitest = (project: string) =>
  runNode([vitestBin, 'run'], project);

/**
 * A project in a temporary directory: the `package.json` and `tsconfig.json`
 * every generated project has, the example files, the linked toolchain.
 */
export const writeExampleProject = async (
  files: readonly ExampleFile[],
): Promise<string> => {
  const root = path.join(await makeTemp(), 'project');
  const shared = renderProject({
    id: 'acme.hello',
    dependencies: { api: '^0.0.0', sdk: '^0.0.0', tools: '^0.0.0' },
  });
  await mkdir(root, { recursive: true });
  for (const name of ['package.json', 'tsconfig.json']) {
    await writeFile(path.join(root, name), shared.get(name) ?? '');
  }
  for (const { file, content } of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await linkToolchain(root);
  return root;
};
