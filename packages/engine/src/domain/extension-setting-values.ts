import type {
  ExtensionSettingDefDto,
  JsonValue,
} from '@dolphy-app/engine-contract';

/** Цвет `#rrggbb` (регистр любой; хранится в нижнем). */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Почему значение не подходит определению (`details.reason` ошибки `INVALID_ARGUMENT`). */
export type SettingValueProblem =
  | 'type'
  | 'integer'
  | 'range'
  | 'max-length'
  | 'option'
  | 'format'
  | 'max-items';

/** Подходит ли значение определению настройки; `null` — подходит. */
export const findSettingValueProblem = (
  def: ExtensionSettingDefDto,
  value: unknown,
): SettingValueProblem | null => {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'type';
    case 'string':
    case 'text':
      if (typeof value !== 'string') return 'type';
      return def.maxLength !== null && value.length > def.maxLength
        ? 'max-length'
        : null;
    case 'color':
      if (typeof value !== 'string') return 'type';
      return COLOR_PATTERN.test(value) ? null : 'format';
    case 'list':
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string')
      ) {
        return 'type';
      }
      if (value.length > def.maxItems) return 'max-items';
      return value.some((item: string) => item.length > def.itemMaxLength)
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

/** Значение в виде, в котором оно хранится: цвет — в нижнем регистре. Значение уже прошло `findSettingValueProblem`. */
export const normalizeSettingValue = (
  def: ExtensionSettingDefDto,
  value: unknown,
): unknown =>
  def.type === 'color' && typeof value === 'string'
    ? value.toLowerCase()
    : value;

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
