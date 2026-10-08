import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { iconDataUri } from '@dolphy-app/extension-catalog';
import { vi } from 'vitest';
import { createExtensionInstaller } from '../src/index.ts';
import type { InspectResult, InstallerOptions } from '../src/index.ts';

export const CATALOG_URL = 'https://catalog.test/index.json';
export const FULL_INDEX_URL = 'https://catalog.test/index.v2.json';
const INSTALL_META = '.dolphy-install.json';

export const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export interface FakeFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExtensionSpec {
  id: string;
  name?: string;
  version: string;
  versions?: string[];
  /** `dependencies` of the manifest and of every version record. */
  dependencies?: { id: string; range?: string }[];
  platforms?: string[];
  apiVersion?: number;
  minAppVersion?: string | null;
  /** `minAppVersion` отдельных версий; перекрывает общий. */
  minAppByVersion?: Record<string, string>;
  /** Содержимое `extension.json` расходится с записью индекса. */
  manifest?: Record<string, unknown>;
  main?: string;
  /** PNG of the icon: `assets/icon.png` joins the files, `icon` joins the manifest and the version record. */
  icon?: Uint8Array;
  /** Files besides `extension.json`, `main.mjs` and the icon. */
  extraFiles?: Record<string, string | Uint8Array>;
  /** `tags` by version: they join the manifest and the version record of that version. */
  tags?: Record<string, string[]>;
  /** `i18n` of the index entry: the Russian name and description. */
  i18n?: { ru: { name?: string; description?: string } };
  /** `deprecated` of the index entry. */
  deprecated?: {
    versions: string | null;
    reason: string;
    alternatives: string[];
  };
}

export const ICON_PATH = 'assets/icon.png';

export const filesOf = (spec: ExtensionSpec, version: string): FakeFile[] => [
  {
    path: 'extension.json',
    content: JSON.stringify({
      id: spec.id,
      version,
      ...(spec.dependencies === undefined
        ? {}
        : { dependencies: spec.dependencies }),
      ...(spec.icon === undefined ? {} : { icon: ICON_PATH }),
      ...(spec.tags?.[version] === undefined
        ? {}
        : { tags: spec.tags[version] }),
      ...spec.manifest,
    }),
  },
  { path: 'main.mjs', content: spec.main ?? `export default '${version}';` },
  ...(spec.icon === undefined ? [] : [{ path: ICON_PATH, content: spec.icon }]),
  ...Object.entries(spec.extraFiles ?? {}).map(([file, content]) => ({
    path: file,
    content,
  })),
];

/** Запись индекса с настоящими sha256 файлов; версии — от новой к старой. */
export const rawEntry = (spec: ExtensionSpec): Record<string, unknown> => ({
  id: spec.id,
  name: spec.name ?? spec.id,
  description: `Description of ${spec.id}`,
  author: 'octo-cat',
  source: 'https://github.com/dolphy-app/dolphy-extensions',
  platforms: spec.platforms ?? [],
  ...(spec.i18n === undefined ? {} : { i18n: spec.i18n }),
  ...(spec.deprecated === undefined ? {} : { deprecated: spec.deprecated }),
  versions: (spec.versions ?? [spec.version]).map((version) => ({
    version,
    apiVersion: spec.apiVersion ?? 1,
    minAppVersion:
      spec.minAppByVersion?.[version] ?? spec.minAppVersion ?? null,
    ...(spec.dependencies === undefined
      ? {}
      : { dependencies: spec.dependencies }),
    publishedAt: '2026-10-01T00:00:00Z',
    baseUrl: `extensions/${spec.id}/${version}/`,
    files: filesOf(spec, version).map((file) => ({
      path: file.path,
      size: Buffer.byteLength(file.content),
      sha256: sha256(file.content),
    })),
    ...(spec.icon === undefined
      ? {}
      : { icon: iconDataUri(ICON_PATH, spec.icon) }),
    ...(spec.tags?.[version] === undefined ? {} : { tags: spec.tags[version] }),
  })),
});

export const rawIndex = (
  entries: ExtensionSpec[],
  options: {
    generatedAt?: string;
    revoked?: { id: string; versions: string; reason: string }[];
  } = {},
): string =>
  JSON.stringify({
    schemaVersion: 2,
    generatedAt: options.generatedAt ?? '2026-10-01T12:00:00Z',
    extensions: entries.map(rawEntry),
    revoked: options.revoked ?? [],
  });

export interface Route {
  status?: number;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  /** Запрос не завершается, пока его не оборвёт `signal`. */
  hang?: boolean;
  /** Сеть недоступна: `fetch` отклоняется. */
  fail?: boolean;
}

export interface FakeCall {
  url: string;
  headers: Record<string, string>;
  redirect: RequestInit['redirect'];
}

export const callsTo = (calls: readonly FakeCall[], url: string): FakeCall[] =>
  calls.filter((call) => call.url === url);

export const createFakeFetch = (routes: Map<string, Route>) => {
  const calls: FakeCall[] = [];
  const fetchFake: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers, redirect: init?.redirect });
    const route = routes.get(url);
    if (route === undefined) return new Response('not found', { status: 404 });
    if (route.fail === true) throw new TypeError('fetch failed');
    if (route.hang === true) {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    const etag = route.headers?.etag;
    if (etag !== undefined && headers['If-None-Match'] === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return new Response(route.body ?? null, {
      status: route.status ?? 200,
      ...(route.headers !== undefined && { headers: route.headers }),
    });
  };
  return { fetch: fetchFake, calls };
};

export const urlOf = (id: string, version: string, file: string): string =>
  `https://catalog.test/extensions/${id}/${version}/${file}`;

/** Кладёт файлы версии на «сервер». */
export const serve = (
  routes: Map<string, Route>,
  spec: ExtensionSpec,
  version = spec.version,
): void => {
  for (const file of filesOf(spec, version)) {
    routes.set(urlOf(spec.id, version, file.path), { body: file.content });
  }
};

/** `index.v2.json` of the catalog. */
export const serveIndex = (
  routes: Map<string, Route>,
  entries: ExtensionSpec[],
  options: Parameters<typeof rawIndex>[1] & { etag?: string } = {},
): void => {
  routes.set(FULL_INDEX_URL, {
    body: rawIndex(entries, options),
    ...(options.etag !== undefined && {
      headers: { etag: options.etag, 'content-type': 'application/json' },
    }),
  });
};

/** `inspectExtensionDir` без зависимостей: разбирает `extension.json` теста. */
export const inspectJson = async (
  directory: string,
): Promise<InspectResult> => {
  try {
    const raw = JSON.parse(
      await readFile(path.join(directory, 'extension.json'), 'utf8'),
    ) as {
      id: string;
      version: string;
      icon?: string;
      tags?: string[];
      dependencies?: { id: string; range?: string }[];
    };
    return {
      ok: true,
      manifest: {
        id: raw.id,
        version: raw.version,
        icon:
          raw.icon === undefined
            ? null
            : iconDataUri(
                raw.icon,
                await readFile(path.join(directory, raw.icon)),
              ),
        tags: raw.tags ?? [],
        dependencies: (raw.dependencies ?? []).map(({ id, range }) => ({
          id,
          range: range ?? null,
        })),
      },
    };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
};

export const createClock = (start = Date.parse('2026-10-01T12:00:00Z')) => {
  const clock = { time: start };
  return {
    now: () => clock.time,
    advance: (ms: number) => {
      clock.time += ms;
    },
  };
};

export const createEnv = async (overrides: Partial<InstallerOptions> = {}) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dolphy-install-'));
  const routes = new Map<string, Route>();
  const fake = createFakeFetch(routes);
  const logger = createLogger();
  const clock = createClock();
  const options: InstallerOptions = {
    catalogUrl: CATALOG_URL,
    extensionsDir: dir,
    bundledIds: () => new Set(),
    appVersion: '1.0.0',
    apiVersion: 1,
    platform: 'darwin',
    inspectDir: inspectJson,
    logger,
    fetch: fake.fetch,
    now: clock.now,
    ...overrides,
  };
  return {
    dir,
    routes,
    fake,
    logger,
    clock,
    options,
    installer: createExtensionInstaller(options),
    /** Новый установщик на тех же каталоге, сети и часах: «перезапуск приложения». */
    restart: (extra: Partial<InstallerOptions> = {}) =>
      createExtensionInstaller({ ...options, ...extra }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
};

export type Env = Awaited<ReturnType<typeof createEnv>>;

/** Каталог, установленный «из каталога»: с файлом `.dolphy-install.json`. */
export const installFake = async (
  dir: string,
  id: string,
  version: string,
  catalogUrl = CATALOG_URL,
): Promise<void> => {
  const target = path.join(dir, id);
  await mkdir(target, { recursive: true });
  await writeFile(
    path.join(target, 'main.mjs'),
    `export default '${version}';`,
  );
  await writeFile(
    path.join(target, INSTALL_META),
    JSON.stringify({
      catalogUrl,
      version,
      installedAt: '2026-09-01T00:00:00.000Z',
    }),
  );
};

export const readText = (...parts: string[]): Promise<string> =>
  readFile(path.join(...parts), 'utf8');
