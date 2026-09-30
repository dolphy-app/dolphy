import type {
  CatalogDto,
  ExtensionUpdateDto,
  InstallResultDto,
} from '@spirula-app/engine-contract';
import type { ExtensionInstaller } from '@spirula-app/engine/ports';

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
  ready?(): void | Promise<void>;
}

export interface FakeExtensionInstallerOptions {
  catalog?: CatalogDto;
  updates?: readonly ExtensionUpdateDto[];
  /** id → причина отзыва (для любой версии). */
  revoked?: Readonly<Record<string, string>>;
  handlers?: FakeExtensionInstallerHandlers;
}

export interface FakeInstallerCall {
  method: keyof ExtensionInstaller;
  args: unknown[];
}

export type FakeExtensionInstaller = ExtensionInstaller & {
  /** Вызовы в порядке поступления (без `revocationOf`: он синхронный и частый). */
  readonly calls: FakeInstallerCall[];
  setRevoked(id: string, reason: string | null): void;
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
          restartRequired: true,
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
  };
};
