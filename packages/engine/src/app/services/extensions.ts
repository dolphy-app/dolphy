import {
  LOG_LEVELS,
  MAX_ANSWER_CHARS,
  MAX_LOG_ENTRIES,
} from '@dolphy-app/engine-contract';
import type {
  CatalogDto,
  ContributionsDto,
  ExtensionCommandFailureReason,
  ExtensionDataUsageDto,
  ExtensionInfoDto,
  ExtensionOriginDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  ExtensionsDiagnosticsDto,
  ExtensionsService,
  InstallResultDto,
  JsonValue,
  ReadLogsOptions,
} from '@dolphy-app/engine-contract';
import {
  isExtensionId,
  normalizeExtensionSettings,
} from '../../domain/extension-settings.ts';
import {
  ExtensionInstallError,
  type ExtensionInstallErrorCause,
} from '../../ports/extension-installer.ts';
import { ExtensionCommandError } from '../../ports/extension-commands.ts';
import type { RegistryContributions } from '../../ports/extension-registry.ts';
import type { LogReadQuery } from '../../ports/log-reader.ts';
import { GRADE_POLICIES } from '../../verify/grade-policy.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { createExtensionValues } from '../extension-values.ts';

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
    settings: [...info.contributes.settings],
    events: [...info.contributes.events],
    commands: [...info.contributes.commands],
    panels: [...info.contributes.panels],
  },
  diagnostics: structuredClone(info.diagnostics),
  permissions: [...info.permissions],
  titles: structuredClone(info.titles),
  messages: structuredClone(info.messages),
  tags: [...info.tags],
});

/**
 * Причины отказа команды, которые считаются сбоем расширения. Остальные —
 * решение системы или состояние хоста (`unknown-command`, `replaced`,
 * `host-down`): расширение в них не виновато.
 */
const COMMAND_FAULTS: ReadonlySet<string> = new Set([
  'handler-failed',
  'timeout',
  'invalid-result',
]);

const BUILTIN_POLICIES = Object.keys(GRADE_POLICIES).map((id) => ({
  id,
  extensionId: null,
  label: null,
}));

const sortedContributions = (
  generation: number,
  source: RegistryContributions,
): ContributionsDto => {
  const copy = structuredClone(source);
  return {
    generation,
    exerciseTypes: copy.exerciseTypes.sort(compareBy((type) => type.type)),
    themes: copy.themes.sort(compareBy((theme) => theme.id)),
    markdownRenderers: copy.markdownRenderers.sort(
      compareBy((renderer) => renderer.language),
    ),
    gradePolicies: [
      ...BUILTIN_POLICIES,
      ...copy.gradePolicies.sort(compareBy((policy) => policy.id)),
    ],
    // между расширениями — по id, внутри расширения — порядок манифеста (так автор управляет формой)
    settings: copy.settings.sort(compareBy((setting) => setting.extensionId)),
    commands: copy.commands.sort(compareBy((command) => command.extensionId)),
    panels: copy.panels.sort(compareBy((panel) => panel.extensionId)),
    messages: copy.messages,
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

/** Аргументы команды — JSON до `MAX_ANSWER_CHARS` знаков; длиннее или не JSON — `INVALID_ARGUMENT` без обращения к расширению. */
const assertArgsSize = (args: JsonValue | undefined): void => {
  let text: string | undefined;
  try {
    text = JSON.stringify(args);
  } catch {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'args must be JSON',
      details: { field: 'args', reason: 'not-json' },
    });
  }
  if ((text?.length ?? 0) > MAX_ANSWER_CHARS) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `args are longer than ${MAX_ANSWER_CHARS} characters`,
      details: {
        field: 'args',
        reason: 'args-too-large',
        limit: MAX_ANSWER_CHARS,
      },
    });
  }
};

const invalidId = (id: unknown): EngineError =>
  new EngineError('INVALID_ARGUMENT', {
    message: `Invalid extension id: ${String(id)}`,
    details: { field: 'id' },
  });

/** `removeData` из параметров `uninstall`: только булево значение; по умолчанию данные остаются. */
const removeDataOf = (options: unknown): boolean => {
  if (options === undefined) return false;
  const removeData =
    typeof options === 'object' && options !== null
      ? Reflect.get(options, 'removeData')
      : null;
  if (removeData === undefined) return false;
  if (typeof removeData !== 'boolean') {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'removeData must be a boolean',
      details: { field: 'removeData' },
    });
  }
  return removeData;
};

/** Параметры `readLogs`: неверное значение — `INVALID_ARGUMENT`, ничего не читается. */
const logQueryOf = (options: ReadLogsOptions | undefined): LogReadQuery => {
  const { extensionId, minLevel, limit = MAX_LOG_ENTRIES } = options ?? {};
  if (extensionId !== undefined && !isExtensionId(extensionId)) {
    throw invalidId(extensionId);
  }
  if (minLevel !== undefined && !LOG_LEVELS.includes(minLevel)) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `Unknown log level: ${String(minLevel)}`,
      details: { field: 'minLevel' },
    });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_ENTRIES) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: `limit must be an integer in 1..${MAX_LOG_ENTRIES}`,
      details: { field: 'limit' },
    });
  }
  return {
    limit,
    ...(extensionId !== undefined && { extensionId }),
    ...(minLevel !== undefined && { minLevel }),
  };
};

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
    | 'extensionHealth'
    | 'extensionHostControl'
    | 'logReader'
    | 'extensionInstaller'
    | 'extensionApply'
    | 'settings'
    | 'extensionData'
    | 'extensionCommands'
    | 'extensionSettingChanges'
    | 'config'
    | 'emit'
    | 'bus'
  >,
): ExtensionsService => {
  const values = createExtensionValues(ctx);
  /** `reload` — изменение действует на расширения (включение, доверие): набор применяется сразу. */
  const persist = async (
    apply: (settings: ExtensionSettingsDto) => ExtensionSettingsDto,
    { reload }: { reload: boolean },
  ): Promise<ExtensionSettingsDto> => {
    const before = await ctx.settings.loadExtensions();
    const next = normalizeExtensionSettings(apply(before));
    if (JSON.stringify(next) === JSON.stringify(before)) return next;
    // сначала хранилище: отказ записи не должен менять живую политику
    await ctx.settings.saveExtensions(next);
    ctx.extensionPolicy.update(next);
    ctx.emit({ type: 'settings-changed', scope: 'extensions' });
    if (reload) await ctx.extensionApply.reload();
    return next;
  };
  const change = async (
    id: string,
    apply: (settings: ExtensionSettingsDto) => ExtensionSettingsDto,
    options: { allowRevoked: boolean },
  ): Promise<ExtensionSettingsDto> => {
    if (!isExtensionId(id)) throw invalidId(id);
    findToggleable(ctx.extensionRegistry.list(), id, options);
    return persist(apply, { reload: true });
  };
  return {
    list: async () =>
      ctx.extensionRegistry.list().map(copyInfo).sort(compareInfo),
    contributions: async () =>
      sortedContributions(
        ctx.extensionApply.generation(),
        ctx.extensionRegistry.contributions(),
      ),
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
      return persist((settings) => ({ ...settings, checkUpdates: enabled }), {
        reload: false,
      });
    },
    setSafeMode: (enabled) => {
      if (typeof enabled !== 'boolean') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'safeMode must be a boolean',
          details: { field: 'enabled' },
        });
      }
      return persist((settings) => ({ ...settings, safeMode: enabled }), {
        reload: true,
      });
    },
    diagnostics: async (): Promise<ExtensionsDiagnosticsDto> => {
      const persisted = (await ctx.settings.loadExtensions()).safeMode;
      const forcedBy = ctx.config.forceSafeMode ?? null;
      const ids = [
        ...new Set(ctx.extensionRegistry.list().map(({ id }) => id)),
      ];
      return {
        host: ctx.extensionHealth.hostStatus(),
        safeMode: {
          active: persisted || forcedBy !== null,
          persisted,
          forcedBy,
        },
        extensions: ids.sort().map((id) => ctx.extensionHealth.get(id)),
      };
    },
    restartHost: async () => ctx.extensionHostControl.restart(),
    readLogs: async (options) => {
      const query = logQueryOf(options);
      return ctx.logReader === null ? [] : ctx.logReader.read(query);
    },
    catalog: (options): Promise<CatalogDto> =>
      guarded(null, () => ctx.extensionInstaller.catalog(options)),
    install: async (id, version): Promise<InstallResultDto> => {
      if (!isExtensionId(id)) throw invalidId(id);
      const result = await guarded(id, () =>
        ctx.extensionInstaller.install(id, version),
      );
      await ctx.extensionApply.reload();
      // вне очереди команд: буфер `emit` дошёл бы до окна только с чужой командой
      ctx.bus.publish({ type: 'extensions-changed' });
      return result;
    },
    uninstall: async (id, options): Promise<void> => {
      if (!isExtensionId(id)) throw invalidId(id);
      const removeData = removeDataOf(options);
      assertRemovable(ctx.extensionRegistry.list(), id);
      await guarded(id, () => ctx.extensionInstaller.uninstall(id));
      await ctx.extensionApply.reload();
      ctx.emit({ type: 'extensions-changed' });
      if (removeData) await values.wipe(id);
    },
    updates: (): Promise<ExtensionUpdateDto[]> =>
      guarded(null, () => ctx.extensionInstaller.updates()),
    getSettingValues: async (id) => values.values(values.requireActive(id)),
    setSettingValue: async (id, settingId, value) => {
      const extensionId = values.requireActive(id);
      if (typeof settingId !== 'string' || settingId === '') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'settingId must be a non-empty string',
          details: { field: 'settingId' },
        });
      }
      return values.set(extensionId, settingId, value);
    },
    resetSettingValues: async (id) => values.reset(values.requireActive(id)),
    dataUsage: async (id): Promise<ExtensionDataUsageDto> => {
      const extensionId = values.requireId(id);
      return {
        storage: await ctx.extensionData.storage.usage(extensionId),
        settings: await ctx.extensionData.settings.usage(extensionId),
        secrets: await ctx.extensionData.secrets.usage(extensionId),
      };
    },
    clearData: async (id) => values.wipe(values.requireId(id)),
    invokeCommand: async (extensionId, commandId, args) => {
      if (!isExtensionId(extensionId)) throw invalidId(extensionId);
      if (typeof commandId !== 'string' || commandId === '') {
        throw new EngineError('INVALID_ARGUMENT', {
          message: 'commandId must be a non-empty string',
          details: { field: 'commandId' },
        });
      }
      assertArgsSize(args);
      const failed = (
        reason: ExtensionCommandFailureReason,
        message: string,
      ): EngineError =>
        new EngineError('EXTENSION_COMMAND_FAILED', {
          message,
          details: { extensionId, commandId, reason },
        });
      const info = ctx.extensionRegistry
        .list()
        .find(
          (item) =>
            item.id === extensionId &&
            (item.state === 'loaded' || item.state === 'disabled'),
        );
      if (info === undefined) {
        throw failed('unknown-command', `Extension not found: ${extensionId}`);
      }
      if (
        info.state === 'disabled' ||
        !ctx.extensionPolicy.isEnabled(extensionId)
      ) {
        throw failed('disabled', `Extension '${extensionId}' is disabled`);
      }
      const declared = ctx.extensionRegistry
        .contributions()
        .commands.some(
          (command) =>
            command.extensionId === extensionId && command.id === commandId,
        );
      if (!declared) {
        throw failed(
          'unknown-command',
          `Command '${commandId}' is not declared by '${extensionId}'`,
        );
      }
      try {
        return await ctx.extensionCommands.invoke(extensionId, commandId, args);
      } catch (error) {
        if (error instanceof ExtensionCommandError) {
          if (COMMAND_FAULTS.has(error.cause)) {
            ctx.extensionHealth.recordFailure(
              extensionId,
              error.cause,
              error.message,
            );
          }
          throw new EngineError('EXTENSION_COMMAND_FAILED', {
            message: error.message,
            details: { extensionId, commandId, reason: error.cause },
            cause: error,
          });
        }
        throw error;
      }
    },
  };
};
