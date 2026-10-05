import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_MIME,
  CATALOG_FILE_EXTENSIONS,
  TITLED_POINTS,
  assetExtensionOf,
  compareSemver,
  iconDataUri,
  parseIndex,
} from '@dolphy-app/extension-catalog';
import type {
  ContributionTitles,
  TitledPoint,
} from '@dolphy-app/extension-catalog';

/** Версия приложения для e2e: `minAppVersion` проверяется только когда она задана. */
export const E2E_APP_VERSION = '1.0.0';

/** Сборка фикстур каталога: подкаталоги `apps/desktop/e2e/fixtures/catalog`. */
export const CATALOG_FIXTURES = fileURLToPath(
  new URL('../fixtures/catalog', import.meta.url),
);

/** Окружение запуска приложения с каталогом на `url`. */
export const catalogEnv = (url: string): Record<string, string> => ({
  DOLPHY_EXTENSION_CATALOG_URL: url,
  DOLPHY_APP_VERSION: E2E_APP_VERSION,
});

export interface CatalogSource {
  /** Каталог расширения с `extension.json` (версия, вклады и разрешения берутся из манифеста). */
  dir: string;
  name: string;
  description: string;
  /** GitHub-логин. */
  author: string;
  platforms?: string[];
}

interface PublishedFile {
  path: string;
  bytes: Buffer;
  sha256: string;
}

interface PublishedVersion {
  version: string;
  /** `data:`-URI значка из манифеста. */
  icon: string | null;
  /** Теги манифеста этой версии. */
  tags: string[];
  apiVersion: number;
  minAppVersion: string | null;
  permissions: string[];
  files: PublishedFile[];
}

interface PublishedExtension {
  id: string;
  name: string;
  description: string;
  author: string;
  platforms: string[];
  contributes: Record<
    'exerciseTypes' | 'themes' | 'markdownRenderers' | 'gradePolicies',
    string[]
  > &
    Partial<
      Record<
        'settings' | 'events' | 'commands' | 'panels' | 'widgets',
        string[]
      >
    >;
  /** Названия вкладов из манифеста (запись индекса `titles`). */
  titles: ContributionTitles;
  versions: PublishedVersion[];
}

interface Revocation {
  id: string;
  versions: string;
  reason: string;
}

/** Пометка «устарело» записи индекса (`deprecated.json` каталога). */
export interface Deprecation {
  /** Диапазон версий; `null` — все. */
  versions: string | null;
  reason: string;
  alternatives: string[];
}

export interface CatalogServerOptions {
  /**
   * `false` — индекс не опубликован: на `index.v2.json` ответ 404 (как у каталога, который
   * его не выкладывает); `index.json` сервер не отдаёт никогда.
   */
  publishIndex?: boolean;
}

export interface CatalogServer {
  /** Адрес каталога (рядом лежит `index.v2.json`) — значение `DOLPHY_EXTENSION_CATALOG_URL`. */
  readonly url: string;
  /** Журнал запросов: `GET <путь> [304]`. */
  readonly requests: readonly string[];
  /** Публикует версию (новое расширение или новая версия имеющегося). */
  publish(source: CatalogSource): Promise<void>;
  /** Отзывает версии по диапазону (`<1.2.0`, `1.1.0`). */
  revoke(id: string, versions: string, reason: string): void;
  /** Помечает расширение устаревшим (`versions: null` — все версии). */
  deprecate(id: string, deprecation: Deprecation): void;
  /** Снимает пометку «устарело». */
  undeprecate(id: string): void;
  /** Сервер отдаёт неверные байты для одного файла версии (sha256 в индексе прежний). */
  tamper(id: string, version: string, path: string): void;
  /** `true` — все запросы получают 503. */
  setOffline(offline: boolean): void;
  close(): Promise<void>;
}

const ALLOWED_EXTENSIONS = new Set(CATALOG_FILE_EXTENSIONS);

const TEXT_MIME: Record<string, string> = {
  json: 'application/json',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** `Content-Type` по расширению файла версии, как у настоящего статического сервера. */
const mimeOf = (path: string): string => {
  const asset = assetExtensionOf(path);
  return asset === null
    ? (TEXT_MIME[path.slice(path.lastIndexOf('.') + 1)] ??
        'application/octet-stream')
    : ASSET_MIME[asset];
};
const MIN_NOW_STEP_MS = 1000;

const listFiles = async (root: string, dir = root): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(root, full)));
    else found.push(relative(root, full).split('\\').join('/'));
  }
  return found;
};

const readFiles = async (dir: string): Promise<PublishedFile[]> => {
  const paths = (await listFiles(dir)).filter((path) =>
    ALLOWED_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1)),
  );
  return Promise.all(
    paths.sort().map(async (path) => {
      const bytes = await readFile(join(dir, path));
      return {
        path,
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }),
  );
};

interface RawManifest {
  id: string;
  version: string;
  apiVersion: number;
  icon?: string;
  tags?: string[];
  minAppVersion?: string;
  permissions?: string[];
  contributes?: {
    exerciseTypes?: { id: string; title?: string }[];
    themes?: { id: string; label: string }[];
    markdownRenderers?: { language: string; title?: string }[];
    gradePolicies?: { id: string; label: string }[];
    settings?: { id: string; label: string }[];
    events?: { event: string }[];
    commands?: { id: string; title: string }[];
    panels?: { id: string; title: string }[];
    widgets?: { id: string; title: string }[];
  };
}

const contributesOf = (
  manifest: RawManifest,
): PublishedExtension['contributes'] => {
  const settings = (manifest.contributes?.settings ?? []).map(({ id }) => id);
  const events = (manifest.contributes?.events ?? []).map(({ event }) => event);
  const commands = (manifest.contributes?.commands ?? []).map(({ id }) => id);
  const panels = (manifest.contributes?.panels ?? []).map(({ id }) => id);
  const widgets = (manifest.contributes?.widgets ?? []).map(({ id }) => id);
  return {
    exerciseTypes: (manifest.contributes?.exerciseTypes ?? []).map(
      ({ id }) => id,
    ),
    themes: (manifest.contributes?.themes ?? []).map(({ id }) => id),
    markdownRenderers: (manifest.contributes?.markdownRenderers ?? []).map(
      ({ language }) => language,
    ),
    gradePolicies: (manifest.contributes?.gradePolicies ?? []).map(
      ({ id }) => id,
    ),
    ...(settings.length > 0 ? { settings } : {}),
    ...(events.length > 0 ? { events } : {}),
    ...(commands.length > 0 ? { commands } : {}),
    ...(panels.length > 0 ? { panels } : {}),
    ...(widgets.length > 0 ? { widgets } : {}),
  };
};

/** `label`/`title` вкладов по точкам, как пишет `catalog build`; пустые точки опущены. */
const titlesOf = (manifest: RawManifest): ContributionTitles => {
  const contributes = manifest.contributes ?? {};
  const byPoint: Record<TitledPoint, { id: string; title: string }[]> = {
    exerciseTypes: (contributes.exerciseTypes ?? []).flatMap(({ id, title }) =>
      title === undefined ? [] : [{ id, title }],
    ),
    markdownRenderers: (contributes.markdownRenderers ?? []).flatMap(
      ({ language, title }) =>
        title === undefined ? [] : [{ id: language, title }],
    ),
    themes: (contributes.themes ?? []).map(({ id, label }) => ({
      id,
      title: label,
    })),
    gradePolicies: (contributes.gradePolicies ?? []).map(({ id, label }) => ({
      id,
      title: label,
    })),
    settings: (contributes.settings ?? []).map(({ id, label }) => ({
      id,
      title: label,
    })),
    commands: (contributes.commands ?? []).map(({ id, title }) => ({
      id,
      title,
    })),
    widgets: (contributes.widgets ?? []).map(({ id, title }) => ({
      id,
      title,
    })),
    panels: (contributes.panels ?? []).map(({ id, title }) => ({ id, title })),
  };
  return Object.fromEntries(
    TITLED_POINTS.filter((point) => byPoint[point].length > 0).map((point) => [
      point,
      Object.fromEntries(byPoint[point].map(({ id, title }) => [id, title])),
    ]),
  );
};

const etagOf = (body: string) =>
  `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;

/**
 * Настоящий HTTP-каталог на 127.0.0.1 со случайным портом: собирает индексы
 * из каталогов расширений (sha256 и размер каждого файла), проверяет их
 * `parseIndex` и отдаёт файлы по `extensions/<id>/<version>/<path>` с `Content-Type` по расширению.
 */
export const startCatalogServer = async (
  sources: readonly CatalogSource[] = [],
  options: CatalogServerOptions = {},
): Promise<CatalogServer> => {
  const publishIndex = options.publishIndex ?? true;
  const extensions = new Map<string, PublishedExtension>();
  const revoked: Revocation[] = [];
  const deprecations = new Map<string, Deprecation>();
  const tampered = new Set<string>();
  const requests: string[] = [];
  let offline = false;
  let generatedAt = 0;

  const publish = async (source: CatalogSource): Promise<void> => {
    const manifest = JSON.parse(
      await readFile(join(source.dir, 'extension.json'), 'utf8'),
    ) as RawManifest;
    const version: PublishedVersion = {
      version: manifest.version,
      tags: manifest.tags ?? [],
      icon:
        manifest.icon === undefined
          ? null
          : iconDataUri(
              manifest.icon,
              await readFile(join(source.dir, manifest.icon)),
            ),
      apiVersion: manifest.apiVersion,
      minAppVersion: manifest.minAppVersion ?? null,
      permissions: manifest.permissions ?? [],
      files: await readFiles(source.dir),
    };
    const known = extensions.get(manifest.id);
    const versions = (known?.versions ?? [])
      .filter((existing) => existing.version !== version.version)
      .concat(version)
      .sort((a, b) => compareSemver(b.version, a.version));
    extensions.set(manifest.id, {
      id: manifest.id,
      name: source.name,
      description: source.description,
      author: source.author,
      platforms: source.platforms ?? [],
      contributes: contributesOf(manifest),
      titles: titlesOf(manifest),
      versions,
    });
  };

  /** Тело `index.v2.json`; `generatedAt` только растёт. */
  const buildIndex = (): string => {
    // индекс не должен «откатываться»: generatedAt только растёт
    generatedAt = Math.max(generatedAt + MIN_NOW_STEP_MS, Date.now());
    const index = {
      schemaVersion: 2,
      generatedAt: new Date(generatedAt).toISOString(),
      extensions: [...extensions.values()].map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        author: entry.author,
        source: `https://example.test/extensions/${entry.id}`,
        platforms: entry.platforms,
        contributes: entry.contributes,
        ...(Object.keys(entry.titles).length === 0
          ? {}
          : { titles: entry.titles }),
        ...(deprecations.has(entry.id)
          ? { deprecated: deprecations.get(entry.id) }
          : {}),
        versions: entry.versions.map((version) => ({
          version: version.version,
          apiVersion: version.apiVersion,
          minAppVersion: version.minAppVersion,
          permissions: version.permissions,
          publishedAt: '2026-01-01T00:00:00.000Z',
          baseUrl: `extensions/${entry.id}/${version.version}/`,
          files: version.files.map(({ path, bytes, sha256 }) => ({
            path,
            size: bytes.length,
            sha256,
          })),
          ...(version.icon === null ? {} : { icon: version.icon }),
          ...(version.tags.length === 0 ? {} : { tags: version.tags }),
        })),
      })),
      revoked: [...revoked],
    };
    parseIndex(index);
    return JSON.stringify(index);
  };

  // тела меняются только при изменении каталога: иначе ETag был бы всегда новым
  let cached: string | null = null;
  const invalidate = () => {
    cached = null;
  };
  const body = () => (cached ??= buildIndex());

  const send = (
    response: ServerResponse,
    status: number,
    body: Buffer | string = '',
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, headers);
    response.end(body);
  };

  const fileFor = (path: string): Buffer | null => {
    const [, , id, version, ...rest] = path.split('/');
    const file = rest.join('/');
    const found = extensions
      .get(id ?? '')
      ?.versions.find((candidate) => candidate.version === version)
      ?.files.find((candidate) => candidate.path === file);
    if (!found) return null;
    const key = `${id}@${version}:${file}`;
    return tampered.has(key) ? Buffer.from('tampered\n') : found.bytes;
  };

  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (offline) {
      requests.push(`GET ${path} 503`);
      send(response, 503, 'catalog is offline');
      return;
    }
    if (path === '/index.v2.json' && !publishIndex) {
      requests.push(`GET ${path} 404`);
      send(response, 404, 'not found');
      return;
    }
    if (path === '/index.v2.json') {
      const text = body();
      const etag = etagOf(text);
      if (request.headers['if-none-match'] === etag) {
        requests.push(`GET ${path} 304`);
        send(response, 304, '', { ETag: etag });
        return;
      }
      requests.push(`GET ${path}`);
      send(response, 200, text, {
        'Content-Type': 'application/json',
        ETag: etag,
      });
      return;
    }
    const file = path.startsWith('/extensions/') ? fileFor(path) : null;
    requests.push(`GET ${path}`);
    if (file === null) send(response, 404, 'not found');
    else send(response, 200, file, { 'Content-Type': mimeOf(path) });
  };

  for (const source of sources) await publish(source);

  const server: Server = createServer(handle);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/index.json`,
    requests,
    publish: async (source) => {
      await publish(source);
      invalidate();
    },
    revoke: (id, versions, reason) => {
      revoked.push({ id, versions, reason });
      invalidate();
    },
    deprecate: (id, deprecation) => {
      deprecations.set(id, deprecation);
      invalidate();
    },
    undeprecate: (id) => {
      deprecations.delete(id);
      invalidate();
    },
    tamper: (id, version, path) => {
      tampered.add(`${id}@${version}:${path}`);
    },
    setOffline: (value) => {
      offline = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/**
 * Расширение, уже установленное из каталога: каталог с метаданными установки
 * (`.dolphy-install.json`), как его оставляет установщик.
 */
export const seedCatalogInstall = async (
  userData: string,
  options: { id: string; dir: string; version: string; catalogUrl: string },
): Promise<void> => {
  const target = join(userData, 'extensions', options.id);
  await mkdir(dirname(target), { recursive: true });
  await cp(options.dir, target, { recursive: true });
  await writeFile(
    join(target, '.dolphy-install.json'),
    JSON.stringify({
      catalogUrl: options.catalogUrl,
      version: options.version,
      installedAt: new Date().toISOString(),
    }),
  );
};
