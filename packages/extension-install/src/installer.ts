import path from 'node:path';
import { EXTENSION_ID_PATTERN } from '@dolphy-app/extension-api';
import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import type { ExtensionInstaller } from '@dolphy-app/engine/ports';
import type {
  CatalogDto,
  DeprecationDto,
  ExtensionDocsDto,
  ExtensionUpdateDto,
  InstallResultDto,
} from '@dolphy-app/engine-contract';
import {
  assertNotRolledBack,
  CatalogFormatError,
  deprecationFor,
  INSTALL_META_FILE,
  isRevoked,
  fullIndexUrl,
  isSafeCatalogPath,
  isSemver,
  latestUpdate,
  parseIndexLenient,
  resolveVersion,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogEntry,
  CatalogIndex,
  CatalogVersion,
  InstallMeta,
  ResolveContext,
} from '@dolphy-app/extension-catalog';
import { randomSuffix } from './atomic.ts';
import { createCatalogCache } from './cache.ts';
import type { CachedIndex } from './cache.ts';
import {
  CHANGELOG_FILE,
  describeEntry,
  toDeprecationDto,
  toVersionDto,
} from './dto.ts';
import { downloadVersion, fetchVerified } from './download.ts';
import { createFileCache } from './file-cache.ts';
import { nodeFs } from './fs.ts';
import { createHttpClient } from './http.ts';
import type { InstallerOptions } from './options.ts';
import { readInstallMeta } from './sidecar.ts';
import { swapDirectory } from './swap.ts';
import { manifestMismatch } from './verify.ts';

const DEFAULT_CACHE_MAX_AGE_MS = 10 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** The full index carries an icon per version (up to ~22 KB each): the former 5 MB would hold a few hundred of them. */
const MAX_INDEX_BYTES = 16_000_000;
const STALE_STAGING_MS = 60 * 60_000;
const MAX_ID_LENGTH = 64;
const SWAP_TRASH = /^(.+)-(\d+)$/;
const REMOVED_DIR = 'removed';
const MAX_MESSAGE_LENGTH = 200;
const README_FILE = 'README.md';
/** Сколько текста README и журнала показывается. */
const MAX_DOC_TEXT_BYTES = 64 * 1024;
/** Файл версии крупнее в кэш не берётся. */
const MAX_VERSION_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 256 * 1024;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Первые `MAX_DOC_TEXT_BYTES` байт как UTF-8 без разрезанного символа на конце. */
const readableText = (
  bytes: Uint8Array,
): { text: string; truncated: boolean } => {
  if (bytes.length <= MAX_DOC_TEXT_BYTES) {
    return { text: new TextDecoder().decode(bytes), truncated: false };
  }
  let end = MAX_DOC_TEXT_BYTES;
  // 0b10xxxxxx — продолжение символа: отступаем к его началу и отбрасываем начатый символ
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return {
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    truncated: true,
  };
};

const imageTypeOf = (filePath: string): string | null => {
  const dot = filePath.lastIndexOf('.');
  return dot < 0
    ? null
    : (IMAGE_TYPES[filePath.slice(dot + 1).toLowerCase()] ?? null);
};

const shortMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_MESSAGE_LENGTH,
  );

const isValidId = (id: string): boolean =>
  id.length <= MAX_ID_LENGTH && EXTENSION_ID_PATTERN.test(id);

const byName = (
  a: { name: string; id: string },
  b: { name: string; id: string },
) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
  a.id.localeCompare(b.id);

export const createExtensionInstaller = (
  options: InstallerOptions,
): ExtensionInstaller => {
  const { logger, extensionsDir, catalogUrl } = options;
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? Date.now;
  const cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;
  /** Отозванные версии индекса никогда не выбираются. */
  const contextFor = (index: CatalogIndex): ResolveContext => ({
    apiVersion: options.apiVersion,
    appVersion: options.appVersion,
    platform: options.platform,
    revoked: index.revoked,
  });
  const http = createHttpClient({
    fetch: options.fetch ?? fetch,
    origin: new URL(catalogUrl).origin,
    userAgent: options.userAgent ?? `dolphy/${options.appVersion ?? 'dev'}`,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });
  const stagingRoot = path.join(extensionsDir, '.staging');
  const trashRoot = path.join(extensionsDir, '.trash');
  const cache = createCatalogCache({
    fs,
    dir: path.join(extensionsDir, '.catalog'),
    catalogUrl,
    logger,
  });
  const fileCache = createFileCache({
    fs,
    dir: path.join(extensionsDir, '.catalog', 'files'),
    logger,
  });

  // holder вместо `let`: функции ниже читают состояние при каждом вызове
  const state: { cached: CachedIndex | null; offline: boolean } = {
    cached: null,
    // последнее обращение к каталогу не удалось: файлы из кэша — «сохранённые данные»
    offline: false,
  };
  const busy = new Set<string>();

  const removeQuietly = async (target: string): Promise<void> => {
    try {
      await fs.remove(target);
    } catch (error) {
      logger.warn({ error, target }, 'leftover directory was not removed');
    }
  };

  const isRestorable = async (dir: string): Promise<boolean> => {
    if ((await fs.stat(path.join(dir, 'extension.json')))?.kind !== 'file') {
      return false;
    }
    const hasMeta = (await fs.stat(path.join(dir, INSTALL_META_FILE))) !== null;
    return !hasMeta || (await readInstallMeta(fs, logger, dir)) !== null;
  };

  /** Записи `.trash`, оставленные заменой каталога: `<id>-<метка времени>`; удаления лежат в `.trash/removed/`. */
  const swapLeftovers = async (): Promise<Map<string, string[]>> => {
    const byId = new Map<string, string[]>();
    for (const name of await fs.list(trashRoot)) {
      const match = SWAP_TRASH.exec(name);
      const id = match?.[1];
      if (id === undefined || !isValidId(id)) continue;
      byId.set(id, [...(byId.get(id) ?? []), name]);
    }
    return byId;
  };

  /**
   * Процесс убили между двумя `rename` замены: `<id>` нет, прежняя версия лежит
   * в `.trash`. Возвращает на место самую новую запись, остальные не трогает.
   */
  const recoverInterruptedSwaps = async (): Promise<void> => {
    for (const [id, names] of await swapLeftovers()) {
      const target = path.join(extensionsDir, id);
      if ((await fs.stat(target)) !== null) continue;
      const newestFirst = [...names].sort(
        (a, b) =>
          Number(SWAP_TRASH.exec(b)?.[2]) - Number(SWAP_TRASH.exec(a)?.[2]),
      );
      for (const name of newestFirst) {
        const source = path.join(trashRoot, name);
        if (!(await isRestorable(source))) continue;
        await fs.rename(source, target);
        logger.info(
          { extensionId: id, from: name },
          'restored interrupted install',
        );
        break;
      }
    }
  };

  const cleanLeftovers = async (): Promise<void> => {
    try {
      await recoverInterruptedSwaps();
    } catch (error) {
      logger.warn({ error }, 'interrupted installs were not recovered');
      return;
    }
    await removeQuietly(trashRoot);
    try {
      for (const name of await fs.list(stagingRoot)) {
        const target = path.join(stagingRoot, name);
        const stat = await fs.stat(target);
        if (stat !== null && now() - stat.mtimeMs > STALE_STAGING_MS) {
          await removeQuietly(target);
        }
      }
    } catch (error) {
      logger.warn({ error }, 'stale staging directories were not cleaned');
    }
  };

  const initialize = async (): Promise<void> => {
    state.cached = await cache.load();
    await cleanLeftovers();
    await fileCache.trim();
  };

  let readyPromise: Promise<void> | null = null;
  const ready = (): Promise<void> => (readyPromise ??= initialize());

  /** Tolerant: entries and versions it cannot read are skipped and logged; the rest of the catalog stays. */
  const parseIndexBytes = (
    bytes: Uint8Array,
    previous: CachedIndex | null,
  ): CatalogIndex => {
    try {
      const { index, warnings } = parseIndexLenient(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (warnings.length > 0) {
        logger.warn({ warnings }, 'some catalog entries were skipped');
      }
      assertNotRolledBack(previous?.index ?? null, index);
      return index;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ExtensionInstallError(
          'catalog-unavailable',
          null,
          'invalid catalog: not valid JSON',
        );
      }
      if (error instanceof CatalogFormatError) {
        throw new ExtensionInstallError(
          'catalog-unavailable',
          null,
          error.message,
        );
      }
      throw error;
    }
  };

  /**
   * `index.v2.json` next to the catalog address; a 404 is an error like any other bad answer
   * (the catalog is unavailable). ETag and cache belong to that one file.
   */
  const fetchIndex = async (): Promise<void> => {
    const previous = state.cached;
    const etag = previous?.etag ?? null;
    const response = await http.get({
      url: fullIndexUrl(catalogUrl),
      headers: {
        Accept: 'application/json',
        ...(etag !== null && { 'If-None-Match': etag }),
      },
      maxBytes: MAX_INDEX_BYTES,
      overflow: 'network',
      allowNotModified: etag !== null,
      extensionId: null,
    });
    const fetchedAt = now();
    if (response.status === 304 && previous !== null) {
      state.cached = { ...previous, fetchedAt };
      await cache.touch(etag, fetchedAt);
      return;
    }
    const index = parseIndexBytes(response.bytes, previous);
    state.cached = { index, etag: response.etag, fetchedAt };
    await cache.save(response.bytes, response.etag, fetchedAt);
  };

  let refreshing: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    refreshing ??= fetchIndex().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const installedMeta = async (id: string): Promise<InstallMeta | null> =>
    readInstallMeta(fs, logger, path.join(extensionsDir, id));

  /** Версия, установленная из этого каталога; скопированные вручную и чужие каталоги — `null`. */
  const installedVersion = async (id: string): Promise<string | null> => {
    const meta = await installedMeta(id);
    return meta?.catalogUrl === catalogUrl ? meta.version : null;
  };

  /** С этим id уже есть расширение: каталог в пользовательском корне или из поставки и режима разработчика. */
  const isTaken = async (id: string): Promise<boolean> =>
    options.bundledIds().has(id) ||
    (await fs.stat(path.join(extensionsDir, id))) !== null;

  const buildCatalog = async (
    cached: CachedIndex,
    error: string | null,
  ): Promise<CatalogDto> => {
    const names = new Map(
      cached.index.extensions.map(({ id, name }) => [id, name]),
    );
    const entries = await Promise.all(
      cached.index.extensions.map(async (entry) => {
        const installed = await installedVersion(entry.id);
        return describeEntry(entry, contextFor(cached.index), installed, {
          elsewhere: installed === null && (await isTaken(entry.id)),
          nameOf: (id) => names.get(id) ?? null,
        });
      }),
    );
    return {
      entries: entries.sort(byName),
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      stale: error !== null,
      error,
    };
  };

  const isFresh = (cached: CachedIndex): boolean => {
    const age = now() - cached.fetchedAt;
    return age >= 0 && age < cacheMaxAgeMs;
  };

  /** Индекс для чтения: свежий кэш, иначе запрос; `error` — запрос не удался и показан кэш. */
  const load = async (
    wantFresh: boolean,
  ): Promise<{ cached: CachedIndex; error: string | null }> => {
    await ready();
    const { cached } = state;
    if (cached !== null && !wantFresh && isFresh(cached)) {
      return { cached, error: null };
    }
    try {
      await refresh();
      state.offline = false;
    } catch (error) {
      if (!(error instanceof ExtensionInstallError)) throw error;
      state.offline = true;
      const message = shortMessage(error);
      if (cached === null) {
        throw new ExtensionInstallError('catalog-unavailable', null, message);
      }
      logger.warn({ error }, 'catalog refresh failed, serving cached index');
      return { cached, error: message };
    }
    const fresh = state.cached;
    if (fresh === null) throw new Error('catalog state is empty after refresh');
    return { cached: fresh, error: null };
  };

  const catalog = async (
    request: { refresh?: boolean } = {},
  ): Promise<CatalogDto> => {
    const { cached, error } = await load(request.refresh === true);
    return buildCatalog(cached, error);
  };

  const requireIndex = async (): Promise<CachedIndex> => {
    if (state.cached === null) await catalog();
    const { cached } = state;
    if (cached === null) throw new Error('catalog state is empty after load');
    return cached;
  };

  const selectVersion = (
    entry: CatalogEntry,
    requested: string | undefined,
    context: ResolveContext,
  ): CatalogVersion => {
    const fail = (message: string) =>
      new ExtensionInstallError('incompatible', entry.id, message);
    if (requested === undefined) {
      const resolution = resolveVersion(entry, context);
      if (resolution.ok) return resolution.version;
      throw fail(resolution.detail);
    }
    const version = entry.versions.find((v) => v.version === requested);
    if (version === undefined) {
      throw fail(`version ${requested} is not in the catalog`);
    }
    const resolution = resolveVersion(
      { ...entry, versions: [version] },
      context,
    );
    if (!resolution.ok) throw fail(resolution.detail);
    return version;
  };

  /** Прежняя установка из каталога или `null`; чужой каталог — `conflict`. */
  const assertReplaceable = async (id: string): Promise<InstallMeta | null> => {
    const stat = await fs.stat(path.join(extensionsDir, id));
    if (stat === null) return null;
    const meta = stat.kind === 'directory' ? await installedMeta(id) : null;
    if (meta?.catalogUrl !== catalogUrl) {
      throw new ExtensionInstallError(
        'conflict',
        id,
        `extension directory '${id}' exists and was not installed from this catalog`,
      );
    }
    return meta;
  };

  const stageVersion = async (
    entry: CatalogEntry,
    version: CatalogVersion,
    staging: string,
  ): Promise<void> => {
    await fs.mkdir(staging);
    await downloadVersion({
      http,
      fs,
      catalogUrl,
      extensionId: entry.id,
      version,
      directory: staging,
    });
    const inspected = await options.inspectDir(staging);
    if (!inspected.ok) {
      throw new ExtensionInstallError('invalid', entry.id, inspected.message);
    }
    const mismatch = manifestMismatch(inspected.manifest, entry, version);
    if (mismatch !== null) {
      throw new ExtensionInstallError('invalid', entry.id, mismatch);
    }
    const meta: InstallMeta = {
      catalogUrl,
      version: version.version,
      installedAt: new Date(now()).toISOString(),
    };
    await fs.writeFile(
      path.join(staging, INSTALL_META_FILE),
      JSON.stringify(meta, null, 2),
    );
  };

  const replaceInstalled = async (
    id: string,
    staging: string,
  ): Promise<InstallMeta | null> => {
    const previous = await assertReplaceable(id);
    const trash = await swapDirectory({
      fs,
      logger,
      staging,
      target: path.join(extensionsDir, id),
      trash: path.join(trashRoot, `${id}-${now()}`),
    });
    if (trash !== null) await removeQuietly(trash);
    return previous;
  };

  const installLocked = async (
    id: string,
    requested: string | undefined,
  ): Promise<InstallResultDto> => {
    const { index } = await requireIndex();
    const entry = index.extensions.find((e) => e.id === id);
    if (entry === undefined) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not in the catalog`,
      );
    }
    const version = selectVersion(entry, requested, contextFor(index));
    if (options.bundledIds().has(id)) {
      throw new ExtensionInstallError(
        'conflict',
        id,
        `'${id}' is provided by the application`,
      );
    }
    await assertReplaceable(id);
    const staging = path.join(stagingRoot, `${id}-${randomSuffix()}`);
    try {
      await stageVersion(entry, version, staging);
      const previous = await replaceInstalled(id, staging);
      return {
        id,
        version: version.version,
        previousVersion: previous?.version ?? null,
      };
    } finally {
      await removeQuietly(staging);
    }
  };

  /** Одна операция над расширением за раз. */
  const exclusive = async <T>(id: string, operation: () => Promise<T>) => {
    if (busy.has(id)) {
      throw new ExtensionInstallError(
        'conflict',
        id,
        `an operation on '${id}' is already in progress`,
      );
    }
    busy.add(id);
    try {
      return await operation();
    } finally {
      busy.delete(id);
    }
  };

  const install = async (
    id: string,
    version?: string,
  ): Promise<InstallResultDto> => {
    await ready();
    if (!isValidId(id)) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not in the catalog`,
      );
    }
    return exclusive(id, () => installLocked(id, version));
  };

  const uninstallLocked = async (id: string): Promise<void> => {
    const target = path.join(extensionsDir, id);
    const stat = await fs.stat(target);
    if (
      stat === null ||
      (stat.kind !== 'directory' && stat.kind !== 'symlink')
    ) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not installed`,
      );
    }
    if (stat.kind === 'symlink') {
      throw new ExtensionInstallError(
        'invalid',
        id,
        `'${id}' is a symbolic link; remove it manually`,
      );
    }
    const removedRoot = path.join(trashRoot, REMOVED_DIR);
    const trash = path.join(removedRoot, `${id}-${now()}-${randomSuffix()}`);
    await fs.mkdir(removedRoot);
    await fs.rename(target, trash);
    await removeQuietly(trash);
  };

  const uninstall = async (id: string): Promise<void> => {
    await ready();
    if (!isValidId(id)) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not installed`,
      );
    }
    await exclusive(id, () => uninstallLocked(id));
  };

  const updates = async (): Promise<ExtensionUpdateDto[]> => {
    await ready();
    const { cached } = state;
    if (cached === null) return [];
    const context = contextFor(cached.index);
    const found = await Promise.all(
      cached.index.extensions.map(
        async (entry): Promise<ExtensionUpdateDto | null> => {
          const installed = await installedVersion(entry.id);
          if (installed === null || !isSemver(installed)) return null;
          const available = latestUpdate(installed, entry, context);
          return available === null
            ? null
            : {
                id: entry.id,
                name: entry.name,
                installed,
                available: toVersionDto(available),
              };
        },
      ),
    );
    return found.filter((update) => update !== null).sort(byName);
  };

  const requireEntry = (index: CatalogIndex, id: string): CatalogEntry => {
    const entry = index.extensions.find((item) => item.id === id);
    if (entry === undefined) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not in the catalog`,
      );
    }
    return entry;
  };

  const requireVersion = (
    entry: CatalogEntry,
    version: string,
  ): CatalogVersion => {
    const found = entry.versions.find((item) => item.version === version);
    if (found === undefined) {
      throw new ExtensionInstallError(
        'not-found',
        entry.id,
        `version ${version} of '${entry.id}' is not in the catalog`,
      );
    }
    return found;
  };

  /** Файл версии по индексу `cached`: из кэша по `sha256`, иначе по сети с проверкой. */
  const catalogFile = async (
    entry: CatalogEntry,
    version: CatalogVersion,
    filePath: string,
  ): Promise<{ bytes: Uint8Array; source: 'catalog' | 'cache' } | null> => {
    const file = version.files.find((item) => item.path === filePath);
    if (file === undefined) return null;
    if (file.size > MAX_VERSION_FILE_BYTES) {
      throw new ExtensionInstallError(
        'limits',
        entry.id,
        `${filePath}: ${file.size} bytes exceed the limit of ${MAX_VERSION_FILE_BYTES}`,
      );
    }
    const hit = await fileCache.get(file.sha256);
    if (hit !== null)
      return { bytes: hit, source: state.offline ? 'cache' : 'catalog' };
    let bytes: Uint8Array;
    try {
      bytes = await fetchVerified(
        { http, catalogUrl, extensionId: entry.id, version },
        file,
      );
    } catch (error) {
      if (error instanceof ExtensionInstallError && error.cause === 'network') {
        state.offline = true;
      }
      throw error;
    }
    state.offline = false;
    await fileCache.put(file.sha256, bytes);
    return { bytes, source: 'catalog' };
  };

  const versionFile: ExtensionInstaller['versionFile'] = async (
    id,
    version,
    filePath,
  ) => {
    const { cached } = await load(false);
    const entry = requireEntry(cached.index, id);
    const found = await catalogFile(
      entry,
      requireVersion(entry, version),
      filePath,
    );
    if (found === null) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${filePath}' is not a file of ${id}@${version}`,
      );
    }
    return found;
  };

  /** Версия, лежащая в каталоге расширения (из любого каталога или скопированная вручную); `null` — каталога нет. */
  const onDiskVersion = async (id: string): Promise<string | null> => {
    const dir = path.join(extensionsDir, id);
    if ((await fs.stat(dir))?.kind !== 'directory') return null;
    const meta = await installedMeta(id);
    if (meta !== null) return meta.version;
    try {
      const manifest: unknown = JSON.parse(
        await fs.readText(path.join(dir, 'extension.json')),
      );
      const version = (manifest as { version?: unknown } | null)?.version;
      return typeof version === 'string' ? version : null;
    } catch {
      return null;
    }
  };

  /** Файл каталога расширения как обычный файл (не ссылка) не больше `limit`; нет — `null`. */
  const installedFile = async (
    id: string,
    filePath: string,
    limit: number,
  ): Promise<Uint8Array | null> => {
    const target = path.join(extensionsDir, id, ...filePath.split('/'));
    const stat = await fs.stat(target);
    if (stat?.kind !== 'file') return null;
    if (stat.size > limit) {
      throw new ExtensionInstallError(
        'limits',
        id,
        `${filePath}: ${stat.size} bytes exceed the limit of ${limit}`,
      );
    }
    return fs.readBytes(target);
  };

  const docsOf = (
    version: string,
    readme: Uint8Array | null,
    changelog: Uint8Array | null,
    source: ExtensionDocsDto['source'],
  ): ExtensionDocsDto => {
    const shownReadme = readme === null ? null : readableText(readme);
    const shownChangelog = changelog === null ? null : readableText(changelog);
    return {
      version,
      readme: shownReadme?.text ?? null,
      changelog: shownChangelog?.text ?? null,
      truncated:
        shownReadme?.truncated === true || shownChangelog?.truncated === true,
      source,
    };
  };

  const docs: ExtensionInstaller['docs'] = async (id, requested) => {
    await ready();
    const notFound = () =>
      new ExtensionInstallError(
        'not-found',
        id,
        `'${id}' is not in the catalog`,
      );
    if (!isValidId(id)) throw notFound();
    const onDisk = await onDiskVersion(id);
    if (onDisk !== null && (requested === undefined || requested === onDisk)) {
      return docsOf(
        onDisk,
        await installedFile(id, README_FILE, MAX_VERSION_FILE_BYTES),
        await installedFile(id, CHANGELOG_FILE, MAX_VERSION_FILE_BYTES),
        'installed',
      );
    }
    const { cached } = await load(false);
    const entry = requireEntry(cached.index, id);
    const resolution = resolveVersion(entry, contextFor(cached.index));
    const shown = resolution.ok ? resolution.version : entry.versions[0];
    const version =
      requested === undefined ? shown : requireVersion(entry, requested);
    if (version === undefined) throw notFound();
    const readme = await catalogFile(entry, version, README_FILE);
    const changelog = await catalogFile(entry, version, CHANGELOG_FILE);
    const fromCache = [readme, changelog].some(
      (item) => item?.source === 'cache',
    );
    return docsOf(
      version.version,
      readme?.bytes ?? null,
      changelog?.bytes ?? null,
      fromCache ? 'cache' : 'catalog',
    );
  };

  const docImage: ExtensionInstaller['docImage'] = async (
    id,
    version,
    filePath,
  ) => {
    await ready();
    const type = imageTypeOf(filePath);
    if (!isValidId(id) || type === null || !isSafeCatalogPath(filePath)) {
      throw new ExtensionInstallError(
        'invalid',
        id,
        `'${filePath}' is not a png, webp or jpeg file of the version`,
      );
    }
    const tooBig = (size: number) =>
      new ExtensionInstallError(
        'limits',
        id,
        `${filePath}: ${size} bytes exceed the limit of ${MAX_IMAGE_BYTES}`,
      );
    let bytes: Uint8Array | null;
    if ((await onDiskVersion(id)) === version) {
      bytes = await installedFile(id, filePath, MAX_IMAGE_BYTES);
    } else {
      const { cached } = await load(false);
      const entry = requireEntry(cached.index, id);
      const target = requireVersion(entry, version);
      const declared = target.files.find((item) => item.path === filePath);
      if (declared !== undefined && declared.size > MAX_IMAGE_BYTES) {
        throw tooBig(declared.size);
      }
      bytes = (await catalogFile(entry, target, filePath))?.bytes ?? null;
    }
    if (bytes === null) {
      throw new ExtensionInstallError(
        'not-found',
        id,
        `'${filePath}' is not a file of ${id}@${version}`,
      );
    }
    return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  };

  const checkForUpdates = async (): Promise<number> => {
    try {
      const result = await catalog({ refresh: true });
      if (result.error !== null) {
        logger.warn({ error: result.error }, 'extension update check failed');
      }
    } catch (error) {
      if (!(error instanceof ExtensionInstallError)) throw error;
      logger.warn({ error }, 'extension update check failed');
    }
    return (await updates()).length;
  };

  const revocationOf = (id: string, version: string): string | null => {
    const { cached } = state;
    if (cached === null || !isSemver(version)) return null;
    return isRevoked(cached.index.revoked, id, version)?.reason ?? null;
  };

  const deprecationOf = (
    id: string,
    version: string,
  ): DeprecationDto | null => {
    const { cached } = state;
    if (cached === null || !isSemver(version)) return null;
    const entry = cached.index.extensions.find((item) => item.id === id);
    const deprecated =
      entry === undefined ? null : deprecationFor(entry, version);
    if (deprecated === null) return null;
    const names = new Map(cached.index.extensions.map((e) => [e.id, e.name]));
    return toDeprecationDto(deprecated, (other) => names.get(other) ?? null);
  };

  return {
    ready,
    catalog,
    install,
    uninstall,
    updates,
    checkForUpdates,
    revocationOf,
    deprecationOf,
    versionFile,
    docs,
    docImage,
  };
};
