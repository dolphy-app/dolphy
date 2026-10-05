import type {
  CatalogInstaller,
  ExtensionInstaller,
} from '@dolphy-app/engine/ports';
import type {
  CatalogSourceDto,
  CatalogSourceOrigin,
} from '@dolphy-app/engine-contract';

export interface SwitchableInstallerOptions {
  /** Официальный каталог. */
  defaultUrl: string;
  /** Адрес из окружения (только несобранное приложение): важнее настройки, переключение запрещено. */
  envUrl?: string | undefined;
  /** Сохранённый адрес настройки; `null` — не задан. */
  settingUrl: string | null;
  /** Установщик одного адреса; вызывается при создании и при каждом переключении. */
  create(catalogUrl: string): CatalogInstaller;
}

/**
 * Переключаемая обёртка над установщиком одного адреса: `useCatalog` создаёт
 * установщик нового адреса (новый origin, кэш индекса по адресу), остальное
 * делегируется действующему. Операции, начатые на прежнем, дорабатывают на нём.
 */
export const createSwitchableInstaller = (
  options: SwitchableInstallerOptions,
): ExtensionInstaller => {
  const { defaultUrl, envUrl, settingUrl, create } = options;
  const originOf = (url: string): CatalogSourceOrigin =>
    url === defaultUrl ? 'default' : 'setting';
  // holder вместо `let` в замыканиях: методы читают установщик при каждом вызове
  const state: { url: string; origin: CatalogSourceOrigin; current: CatalogInstaller } =
    (() => {
      const url = envUrl ?? settingUrl ?? defaultUrl;
      return {
        url,
        origin: envUrl === undefined ? originOf(url) : 'env',
        current: create(url),
      };
    })();
  return {
    ready: () => state.current.ready(),
    catalog: (options) => state.current.catalog(options),
    install: (id, version) => state.current.install(id, version),
    uninstall: (id) => state.current.uninstall(id),
    updates: () => state.current.updates(),
    checkForUpdates: () => state.current.checkForUpdates(),
    revocationOf: (id, version, catalogUrl) =>
      state.current.revocationOf(id, version, catalogUrl),
    deprecationOf: (id, version, catalogUrl) =>
      state.current.deprecationOf(id, version, catalogUrl),
    versionFile: (id, version, path) =>
      state.current.versionFile(id, version, path),
    docs: (id, version) => state.current.docs(id, version),
    docImage: (id, version, path) => state.current.docImage(id, version, path),
    catalogSource: (): CatalogSourceDto => ({
      url: state.url,
      default: defaultUrl,
      origin: state.origin,
    }),
    useCatalog: async (url) => {
      if (state.origin === 'env') {
        throw new Error('the catalog address is set by the environment');
      }
      const target = url ?? defaultUrl;
      if (target === state.url) return;
      const next = create(target);
      // кэш нового адреса читается до подмены: отзыв и обновления работают сразу
      await next.ready();
      state.url = target;
      state.origin = originOf(target);
      state.current = next;
    },
  };
};
