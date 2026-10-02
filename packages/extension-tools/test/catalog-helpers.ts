import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyProject, linkSdk, makeTemp } from './helpers.ts';

export type Fixture =
  'theme-only' | 'markdown-only' | 'hello' | 'commands-panel';

export interface ExtensionSpec {
  fixture: Fixture;
  /** Поля, подмешиваемые в `extension.json` поверх метаданных публикации. */
  manifest?: Record<string, unknown>;
  /** Содержимое файлов поверх проекта; `null` — удалить файл. */
  files?: Record<string, string | null>;
  /** Имя каталога, если оно должно отличаться от id. */
  dirName?: string;
}

export interface Repo {
  root: string;
  extensionsDir: string;
  dirOf(id: string): string;
}

const PUBLICATION = {
  name: 'Sample',
  description: 'A sample extension for the catalog',
  author: 'octo-cat',
};

const DEFAULT_FILES: Record<string, string> = {
  'README.md': '# Sample\n',
  'package.json': '{"name":"sample","private":true,"devDependencies":{}}\n',
  'package-lock.json': '{}\n',
};

const writeRelative = async (
  dir: string,
  file: string,
  content: string | null,
): Promise<void> => {
  const target = path.join(dir, file);
  if (content === null) {
    await rm(target, { force: true });
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

export const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, 'utf8'));

export const readManifest = async (
  file: string,
): Promise<{ id: string } & Record<string, unknown>> =>
  (await readJson(file)) as { id: string } & Record<string, unknown>;

/** Проект расширения каталога: фикстура + метаданные публикации, README, package.json, lock-файл. */
export const addExtension = async (
  repo: Repo,
  spec: ExtensionSpec,
): Promise<string> => {
  const source = await copyProject(spec.fixture, { isLinked: false });
  const manifestFile = path.join(source, 'extension.json');
  const manifest = await readManifest(manifestFile);
  const dirName = spec.dirName ?? manifest.id;
  const target = path.join(repo.extensionsDir, dirName);
  await cp(source, target, { recursive: true });
  await writeFile(
    path.join(target, 'extension.json'),
    `${JSON.stringify({ ...manifest, ...PUBLICATION, ...spec.manifest }, null, 2)}\n`,
  );
  const files = { ...DEFAULT_FILES, ...spec.files };
  for (const [file, content] of Object.entries(files)) {
    await writeRelative(target, file, content);
  }
  if (spec.fixture !== 'theme-only') await linkSdk(target);
  return target;
};

export const createRepo = async (
  specs: readonly ExtensionSpec[] = [],
): Promise<Repo> => {
  const root = await makeTemp();
  const extensionsDir = path.join(root, 'extensions');
  await mkdir(extensionsDir);
  const repo: Repo = {
    root,
    extensionsDir,
    dirOf: (id) => path.join(extensionsDir, id),
  };
  for (const spec of specs) await addExtension(repo, spec);
  return repo;
};

export const setVersion = async (
  repo: Repo,
  id: string,
  version: string,
): Promise<void> => {
  const file = path.join(repo.dirOf(id), 'extension.json');
  const manifest = await readManifest(file);
  await writeFile(file, `${JSON.stringify({ ...manifest, version })}\n`);
};

export const renameDir = (repo: Repo, from: string, to: string) =>
  rename(repo.dirOf(from), repo.dirOf(to));

export interface PublishedVersion {
  version: string;
}

/** Опубликованный индекс с одним расширением и перечисленными версиями (новые первыми). */
export const publishedIndex = (
  id: string,
  versions: readonly string[],
): unknown => ({
  schemaVersion: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  extensions: [
    {
      id,
      name: 'Sample',
      description: 'Sample',
      author: 'octo-cat',
      source: `https://github.com/dolphy-app/dolphy-extensions/tree/main/extensions/${id}`,
      platforms: [],
      contributes: {
        exerciseTypes: [],
        themes: [id],
        markdownRenderers: [],
        gradePolicies: [],
      },
      versions: versions.map((version) => ({
        version,
        apiVersion: 1,
        minAppVersion: null,
        permissions: [],
        publishedAt: '2026-10-01T00:00:00.000Z',
        baseUrl: `extensions/${id}/${version}/`,
        files: [
          {
            path: 'extension.json',
            size: 1,
            sha256: 'a'.repeat(64),
          },
        ],
      })),
    },
  ],
  revoked: [],
});

export const writePublished = async (
  repo: Repo,
  id: string,
  versions: readonly string[],
): Promise<string> => {
  const file = path.join(repo.root, 'published.json');
  await writeFile(file, JSON.stringify(publishedIndex(id, versions)));
  return file;
};

export const createIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
};
