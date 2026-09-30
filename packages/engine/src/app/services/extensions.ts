import type {
  CatalogDto,
  ContributionsDto,
  ExtensionInfoDto,
  ExtensionOriginDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  ExtensionsService,
  InstallResultDto,
} from '@spirula-app/engine-contract';
import {
  isExtensionId,
  normalizeExtensionSettings,
} from '../../domain/extension-settings.ts';
import {
  ExtensionInstallError,
  type ExtensionInstallErrorCause,
} from '../../ports/extension-installer.ts';
import { GRADE_POLICIES } from '../../verify/grade-policy.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';

/** Не чаще раза в сутки. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type InstallFailure = (
  error: ExtensionInstallError,
  extensionId: string | null,
) => EngineError;

const installFailed: InstallFailure = (error, extensionId) =>
  new EngineError('EXTENSION_INSTALL_FAILED', {
    message: error.message,
    details: { reason: error.cause, extensionId },
    cause: error,
  });

/** Причина установщика → код ошибки движка; всё, чего нет в таблице, — `EXTENSION_INSTALL_FAILED`. */
const INSTALL_FAILURES: Readonly<
  Partial<Record<ExtensionInstallErrorCause, InstallFailure>>
> = {
  'not-found': (error, extensionId) =>
    new EngineError('NOT_FOUND', {
      message: error.message,
      details: { extensionId },
      cause: error,
    }),
  'catalog-unavailable': (error) =>
    new EngineError('CATALOG_UNAVAILABLE', {
      message: error.message,
      cause: error,
    }),
};

/** Ошибки установщика — операционные и получают код; остальные (ошибки программиста) уходят дальше как есть. */
const translateInstallError = (
  error: unknown,
  extensionId: string | null,
): unknown =>
  error instanceof ExtensionInstallError
    ? (INSTALL_FAILURES[error.cause] ?? installFailed)(error, extensionId)
    : error;

const guarded = async <T>(
  extensionId: string | null,
  run: () => Promise<T>,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw translateInstallError(error, extensionId);
  }
};

const ORIGIN_RANK: Readonly<Record<ExtensionOriginDto, number>> = {
  bundled: 0,
  user: 1,
  dev: 2,
};

const compareInfo = (a: ExtensionInfoDto, b: ExtensionInfoDto): number => {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
};

const compareBy =
  <T>(key: (item: T) => string) =>
  (a: T, b: T): number => {
    const [left, right] = [key(a), key(b)];
    if (left === right) return 0;
    return left < right ? -1 : 1;
  };

const copyInfo = (info: ExtensionInfoDto): ExtensionInfoDto => ({
  ...info,
  contributes: {
    exerciseTypes: [...info.contributes.exerciseTypes],
    themes: [...info.contributes.themes],
    markdownRenderers: [...info.contributes.markdownRenderers],
    gradePolicies: [...info.contributes.gradePolicies],
  },
  permissions: [...info.permissions],
});

const BUILTIN_POLICIES = Object.keys(GRADE_POLICIES).map((id) => ({
  id,
  extensionId: null,
  label: null,
}));

const sortedContributions = (source: ContributionsDto): ContributionsDto => {
  const copy = structuredClone(source);
  return {
    themes: copy.themes.sort(compareBy((theme) => theme.id)),
    markdownRenderers: copy.markdownRenderers.sort(
      compareBy((renderer) => renderer.language),
    ),
    gradePolicies: [
      ...BUILTIN_POLICIES,
      ...copy.gradePolicies.sort(compareBy((policy) => policy.id)),
    ],
  };
};

/** Расширение, чьи настройки можно менять: действующее (`loaded`/`disabled`) и не из поставки. */
const findToggleable = (
  items: readonly ExtensionInfoDto[],
  id: string,
  { allowRevoked }: { allowRevoked: boolean },
): ExtensionInfoDto => {
  const known = items.filter((item) => item.id === id);
  if (known.length === 0) {
    throw new EngineError('NOT_FOUND', {
      message: `Extension not found: ${id}`,
      details: { extensionId: id },
    });
  }
  const effective = known.find(
    ({ state }) => state === 'loaded' || state === 'disabled',
  );
  if (effective === undefined || effective.origin === 'bundled') {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `Extension '${id}' cannot be configured`,
      details: {
        reason: effective === undefined ? 'not-loaded' : 'bundled',
        extensionId: id,
      },
    });
  }
  if (!allowRevoked && effective.revoked !== null) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `Extension '${id}' is revoked: ${effective.revoked}`,
      details: { reason: 'revoked', extensionId: id },
    });
  }
  return effective;
};

const invalidId = (id: unknown): EngineError =>
  new EngineError('INVALID_ARGUMENT', {
    message: `Invalid extension id: ${String(id)}`,
    details: { field: 'id' },
  });

const withMember = (
  ids: readonly string[],
  id: string,
  member: boolean,
): string[] => {
  const rest = ids.filter((item) => item !== id);
  return member ? [...rest, id] : rest;
};

/** Расширение, которое можно удалить: есть в реестре с origin `user`. */
const assertRemovable = (
  items: readonly ExtensionInfoDto[],
  id: string,
): void => {
  const known = items.filter((item) => item.id === id);
  if (known.length === 0) {
    throw new EngineError('NOT_FOUND', {
      message: `Extension not found: ${id}`,
      details: { extensionId: id },
    });
  }
  if (!known.some(({ removable }) => removable)) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `Extension '${id}' cannot be removed`,
      details: { reason: 'not-removable', extensionId: id },
    });
  }
};

type UpdateCheckContext = Pick<
  EngineContext,
  'extensionInstaller' | 'settings' | 'clock' | 'logger' | 'bus' | 'state'
>;

/**
 * Фоновая проверка обновлений при запуске: только если настройка включена и
 * с прошлой проверки прошли сутки. Не бросает и не задерживает запуск — вызывающий
 * не ждёт результат; ошибки только логируются.
 */
export const runStartupUpdateCheck = async (
  ctx: UpdateCheckContext,
): Promise<void> => {
  const { extensionInstaller: installer, settings, clock, bus } = ctx;
  try {
    await installer.ready();
    if (!(await settings.loadExtensions()).checkUpdates) return;
    const now = clock.now();
    const last = await settings.loadUpdateCheckedAt();
    if (last !== null && last <= now && now - last < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
    const available = await installer.checkForUpdates();
    if (ctx.state.closed) return;
    await settings.saveUpdateCheckedAt(now);
    if (available > 0) bus.publish({ type: 'extensions-changed' });
  } catch (error) {
    ctx.logger.warn({ error }, 'extension update check failed');
  }
};

/** `extensions.*`: снимки реестра, копии записей, настройки включения, доверия и проверки обновлений, установка из каталога. */
export const createExtensionsService = (
  ctx: Pick<
    EngineContext,
    | 'extensionRegistry'
    | 'extensionPolicy'
    | 'extensionInstaller'
    | 'settings'
    | 'emit'
    | 'bus'
  >,
): ExtensionsService => {
  const persist = async (
    apply: (settings: ExtensionSettingsDto) => ExtensionSettingsDto,
  ): Promise<ExtensionSettingsDto> => {
    const before = await ctx.settings.loadExtensions();
    const next = normalizeExtensionSettings(apply(before));
    if (JSON.stringify(next) === JSON.stringify(before)) return next;
    // сначала хранилище: отказ записи не должен менять живую политику
    await ctx.settings.saveExtensions(next);
    ctx.extensionPolicy.update(next);
    ctx.emit({ type: 'settings-changed', scope: 'extensions' });
    return next;
  };
  const change = async (
    id: string,
    apply: (settings: ExtensionSettingsDto) => ExtensionSettingsDto,
    options: { allowRevoked: boolean },
  ): Promise<ExtensionSettingsDto> => {
    if (!isExtensionId(id)) throw invalidId(id);
    findToggleable(ctx.extensionRegistry.list(), id, options);
    return persist(apply);
  };
  return {
    list: async () =>
      ctx.extensionRegistry.list().map(copyInfo).sort(compareInfo),
    contributions: async () =>
      sortedContributions(ctx.extensionRegistry.contributions()),
    getSettings: async () =>
      normalizeExtensionSettings(await ctx.settings.loadExtensions()),
    setEnabled: (id, enabled) =>
      change(
        id,
        (settings) => ({
          ...settings,
          disabled: withMember(settings.disabled, id, !enabled),
        }),
        { allowRevoked: false },
      ),
    setTrusted: (id, trusted) =>
      change(
        id,
        (settings) => ({
          ...settings,
          trusted: withMember(settings.trusted, id, trusted),
        }),
        { allowRevoked: true },
      ),
    setCheckUpdates: (enabled) => {
      if (typeof enabled !== 'boolean') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'checkUpdates must be a boolean',
          details: { field: 'enabled' },
        });
      }
      return persist((settings) => ({ ...settings, checkUpdates: enabled }));
    },
    catalog: (options): Promise<CatalogDto> =>
      guarded(null, () => ctx.extensionInstaller.catalog(options)),
    install: async (id, version): Promise<InstallResultDto> => {
      if (!isExtensionId(id)) throw invalidId(id);
      const result = await guarded(id, () =>
        ctx.extensionInstaller.install(id, version),
      );
      // вне очереди команд: буфер `emit` дошёл бы до окна только с чужой командой
      ctx.bus.publish({ type: 'extensions-changed' });
      return result;
    },
    uninstall: async (id): Promise<void> => {
      if (!isExtensionId(id)) throw invalidId(id);
      assertRemovable(ctx.extensionRegistry.list(), id);
      await guarded(id, () => ctx.extensionInstaller.uninstall(id));
      ctx.emit({ type: 'extensions-changed' });
    },
    updates: (): Promise<ExtensionUpdateDto[]> =>
      guarded(null, () => ctx.extensionInstaller.updates()),
  };
};
