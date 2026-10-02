import type {
  ExtensionSettingDefDto,
  JsonValue,
} from '@dolphy-app/engine-contract';

/** Почему значение не подходит определению (`details.reason` ошибки `INVALID_ARGUMENT`). */
export type SettingValueProblem =
  'type' | 'integer' | 'range' | 'max-length' | 'option';

/** Подходит ли значение определению настройки; `null` — подходит. */
export const findSettingValueProblem = (
  def: ExtensionSettingDefDto,
  value: unknown,
): SettingValueProblem | null => {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'type';
    case 'string':
      if (typeof value !== 'string') return 'type';
      return def.maxLength !== null && value.length > def.maxLength
        ? 'max-length'
        : null;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
      if (def.integer && !Number.isInteger(value)) return 'integer';
      if (def.min !== null && value < def.min) return 'range';
      if (def.max !== null && value > def.max) return 'range';
      return null;
    default:
      if (typeof value !== 'string') return 'type';
      return def.options.some((option) => option.value === value)
        ? null
        : 'option';
  }
};

/**
 * Действующие значения: по одному на определение — сохранённое, если оно всё
 * ещё подходит определению (после обновления расширения границы могли
 * измениться), иначе `default`. Сохранённые ключи без определения игнорируются.
 */
export const effectiveSettingValues = (
  defs: readonly ExtensionSettingDefDto[],
  stored: Readonly<Record<string, JsonValue>>,
): Record<string, JsonValue> =>
  Object.fromEntries(
    defs.map((def) => {
      const saved = Object.hasOwn(stored, def.id) ? stored[def.id] : undefined;
      const usable =
        saved !== undefined && findSettingValueProblem(def, saved) === null;
      return [def.id, usable ? saved : def.default];
    }),
  );
