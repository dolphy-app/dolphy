import { isEffectiveExtensionState } from '@dolphy-app/engine-contract';
import type {
  ExtensionSettingDefDto,
  ExtensionSettingValuesDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import {
  effectiveSettingValues,
  findSettingValueProblem,
  isExtensionId,
  normalizeSettingValue,
} from '../domain/index.ts';
import type { EngineContext } from './context.ts';
import { EngineError } from './errors.ts';

type ValuesContext = Pick<
  EngineContext,
  | 'extensionRegistry'
  | 'extensionPolicy'
  | 'extensionData'
  | 'extensionSettingChanges'
  | 'emit'
>;

/**
 * Значения настроек расширений и доступ расширения к своим данным: общая
 * часть UI-методов `extensions.*` и `ExtensionHostServices`. Определения —
 * вклады включённых расширений (`ExtensionRegistry.contributions().settings`),
 * сохранённое — `ExtensionDataStore.settings`.
 */
export interface ExtensionValues {
  /**
   * Расширение действует: id корректен, расширение найдено и включено.
   * `INVALID_ARGUMENT` (id или `reason: 'disabled'`), `NOT_FOUND`.
   */
  requireActive(extensionId: unknown): string;
  /** Корректный id; расширение может быть и удалено (данные остаются). */
  requireId(extensionId: unknown): string;
  definitions(extensionId: string): ExtensionSettingDefDto[];
  values(extensionId: string): Promise<ExtensionSettingValuesDto>;
  set(
    extensionId: string,
    settingId: string,
    value: unknown,
  ): Promise<ExtensionSettingValuesDto>;
  reset(extensionId: string): Promise<ExtensionSettingValuesDto>;
  /** Стирает хранилище и значения настроек; подписчики узнают об изменившихся значениях. */
  wipe(extensionId: string): Promise<void>;
}

const invalidId = (id: unknown): EngineError =>
  new EngineError('INVALID_ARGUMENT', {
    message: `Invalid extension id: ${String(id)}`,
    details: { field: 'id' },
  });

export const createExtensionValues = (ctx: ValuesContext): ExtensionValues => {
  const requireId = (extensionId: unknown): string => {
    if (!isExtensionId(extensionId)) throw invalidId(extensionId);
    return extensionId;
  };

  const requireActive = (extensionId: unknown): string => {
    const id = requireId(extensionId);
    const effective = ctx.extensionRegistry
      .list()
      .find((item) => item.id === id && isEffectiveExtensionState(item.state));
    if (effective === undefined) {
      throw new EngineError('NOT_FOUND', {
        message: `Extension not found: ${id}`,
        details: { extensionId: id },
      });
    }
    if (effective.state === 'disabled' || !ctx.extensionPolicy.isEnabled(id)) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Extension '${id}' is disabled`,
        details: { reason: 'disabled', extensionId: id },
      });
    }
    return id;
  };

  const definitions = (extensionId: string): ExtensionSettingDefDto[] =>
    ctx.extensionRegistry
      .contributions()
      .settings.filter((def) => def.extensionId === extensionId)
      .map((def) => structuredClone(def));

  const values = async (
    extensionId: string,
  ): Promise<ExtensionSettingValuesDto> =>
    effectiveSettingValues(
      definitions(extensionId),
      await ctx.extensionData.settings.all(extensionId),
    );

  /** Что изменилось между двумя наборами действующих значений. */
  const announce = (
    extensionId: string,
    before: Readonly<Record<string, JsonValue>>,
    after: Readonly<Record<string, JsonValue>>,
  ): void => {
    for (const [id, value] of Object.entries(after)) {
      if (JSON.stringify(before[id]) === JSON.stringify(value)) continue;
      ctx.extensionSettingChanges.emit({ extensionId, id, value });
    }
  };

  const changed = (extensionId: string): void => {
    ctx.emit({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId,
    });
  };

  const set = async (
    extensionId: string,
    settingId: string,
    value: unknown,
  ): Promise<ExtensionSettingValuesDto> => {
    const defs = definitions(extensionId);
    const def = defs.find((item) => item.id === settingId);
    if (def === undefined) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Unknown setting '${settingId}' of extension '${extensionId}'`,
        details: { reason: 'unknown-setting', extensionId, settingId },
      });
    }
    const problem = findSettingValueProblem(def, value);
    if (problem !== null) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Invalid value for setting '${settingId}' (${problem})`,
        details: { reason: problem, extensionId, settingId },
      });
    }
    const normalized = normalizeSettingValue(def, value) as JsonValue;
    const stored = await ctx.extensionData.settings.all(extensionId);
    const before = effectiveSettingValues(defs, stored);
    await ctx.extensionData.settings.set(extensionId, settingId, normalized);
    const after = effectiveSettingValues(defs, {
      ...stored,
      [settingId]: normalized,
    });
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      announce(extensionId, before, after);
      changed(extensionId);
    }
    return after;
  };

  const reset = async (
    extensionId: string,
  ): Promise<ExtensionSettingValuesDto> => {
    const defs = definitions(extensionId);
    const stored = await ctx.extensionData.settings.all(extensionId);
    const before = effectiveSettingValues(defs, stored);
    await ctx.extensionData.settings.deleteAll(extensionId);
    const after = effectiveSettingValues(defs, {});
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      announce(extensionId, before, after);
      changed(extensionId);
    }
    return after;
  };

  const wipe = async (extensionId: string): Promise<void> => {
    const defs = definitions(extensionId);
    const before = effectiveSettingValues(
      defs,
      await ctx.extensionData.settings.all(extensionId),
    );
    await ctx.extensionData.deleteAllData(extensionId);
    announce(extensionId, before, effectiveSettingValues(defs, {}));
    changed(extensionId);
  };

  return { requireActive, requireId, definitions, values, set, reset, wipe };
};
