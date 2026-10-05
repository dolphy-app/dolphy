import type {
  CatalogDto,
  DeprecationDto,
  ExtensionDocsDto,
  ExtensionUpdateDto,
  InstallResultDto,
} from '@dolphy-app/engine-contract';
import type { ExtensionInstaller } from '@dolphy-app/engine/ports';

/** Поведение метода фейка: свой обработчик (может бросать, в том числе `ExtensionInstallError`). */
export interface FakeExtensionInstallerHandlers {
  catalog?(options?: { refresh?: boolean }): CatalogDto | Promise<CatalogDto>;
  install?(
    id: string,
    version?: string,
  ): InstallResultDto | Promise<InstallResultDto>;
  uninstall?(id: string): void | Promise<void>;
  updates?(): ExtensionUpdateDto[] | Promise<ExtensionUpdateDto[]>;
  checkForUpdates?(): number | Promise<number>;
  docs?(
    id: string,
    version?: string,
  ): ExtensionDocsDto | Promise<ExtensionDocsDto>;
  docImage?(
    id: string,
    version: string,
    path: string,
  ): string | Promise<string>;
  versionFile?(
    id: string,
    version: string,
    path: string,
  ):
    | { bytes: Uint8Array; source: 'catalog' | 'cache' }
    | Promise<{ bytes: Uint8Array; source: 'catalog' | 'cache' }>;
  ready?(): void | Promise<void>;
}

export interface FakeExtensionInstallerOptions {
  catalog?: CatalogDto;
  updates?: readonly ExtensionUpdateDto[];
  /** id → причина отзыва (для любой версии). */
  revoked?: Readonly<Record<string, string>>;
  /** id → пометка «устарело» (для любой версии). */
  deprecated?: Readonly<Record<string, DeprecationDto>>;
  handlers?: FakeExtensionInstallerHandlers;
}

export interface FakeInstallerCall {
  method: keyof ExtensionInstaller;
  args: unknown[];
}

export type FakeExtensionInstaller = ExtensionInstaller & {
  /** Вызовы в порядке поступления (без `revocationOf` и `deprecationOf`: они синхронные и частые). */
  readonly calls: FakeInstallerCall[];
  setRevoked(id: string, reason: string | null): void;
  setDeprecated(id: string, deprecation: DeprecationDto | null): void;
};

const EMPTY_CATALOG: CatalogDto = {
  entries: [],
  fetchedAt: null,
  stale: false,
  error: null,
};

/** Установщик в памяти: по умолчанию пустой каталог, успешная установка, нет обновлений. */
export const createFakeExtensionInstaller = (
  options: FakeExtensionInstallerOptions = {},
): FakeExtensionInstaller => {
  const { handlers = {} } = options;
  const calls: FakeInstallerCall[] = [];
  const revoked = new Map(Object.entries(options.revoked ?? {}));
  const deprecated = new Map(Object.entries(options.deprecated ?? {}));
  const updates = options.updates ?? [];
  const record = (method: keyof ExtensionInstaller, args: unknown[]): void => {
    calls.push({ method, args });
  };
  return {
    calls,
    setRevoked: (id, reason) => {
      if (reason === null) revoked.delete(id);
      else revoked.set(id, reason);
    },
    setDeprecated: (id, deprecation) => {
      if (deprecation === null) deprecated.delete(id);
      else deprecated.set(id, deprecation);
    },
    ready: async () => {
      record('ready', []);
      await handlers.ready?.();
    },
    catalog: async (request) => {
      record('catalog', request === undefined ? [] : [request]);
      return structuredClone(
        (await handlers.catalog?.(request)) ?? options.catalog ?? EMPTY_CATALOG,
      );
    },
    install: async (id, version) => {
      record('install', version === undefined ? [id] : [id, version]);
      return (
        (await handlers.install?.(id, version)) ?? {
          id,
          version: version ?? '1.0.0',
          previousVersion: null,
        }
      );
    },
    uninstall: async (id) => {
      record('uninstall', [id]);
      await handlers.uninstall?.(id);
    },
    updates: async () => {
      record('updates', []);
      return structuredClone((await handlers.updates?.()) ?? [...updates]);
    },
    checkForUpdates: async () => {
      record('checkForUpdates', []);
      return (await handlers.checkForUpdates?.()) ?? updates.length;
    },
    revocationOf: (id) => revoked.get(id) ?? null,
    deprecationOf: (id) => structuredClone(deprecated.get(id) ?? null),
    docs: async (id, version) => {
      record('docs', version === undefined ? [id] : [id, version]);
      return structuredClone(
        (await handlers.docs?.(id, version)) ?? {
          version: version ?? '1.0.0',
          readme: null,
          changelog: null,
          truncated: false,
          source: 'catalog' as const,
        },
      );
    },
    docImage: async (id, version, path) => {
      record('docImage', [id, version, path]);
      return (
        (await handlers.docImage?.(id, version, path)) ??
        'data:image/png;base64,'
      );
    },
    versionFile: async (id, version, path) => {
      record('versionFile', [id, version, path]);
      return (
        (await handlers.versionFile?.(id, version, path)) ?? {
          bytes: new Uint8Array(0),
          source: 'catalog' as const,
        }
      );
    },
  };
};
