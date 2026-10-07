import type {
  ExtensionSettingDefDto,
  ExtensionSettingValuesDto,
} from '@dolphy-app/engine-contract';
import type { LocalizedText } from '@dolphy-app/extension-api';

/** Раздел формы настроек: `title === null` — первый раздел без заголовка. */
export interface SettingsSection {
  title: string | null;
  fields: ExtensionSettingDefDto[];
}

/**
 * Поле видно, пока условие `visibleWhen` выполнено: значение настройки-цели
 * (нет значения — её `default`) равно `equals`. Цель, которой нет среди
 * определений, условие не выполняет. Скрытое значение не затрагивается.
 */
export const isSettingVisible = (
  definition: ExtensionSettingDefDto,
  definitions: readonly ExtensionSettingDefDto[],
  values: Readonly<ExtensionSettingValuesDto>,
): boolean => {
  const { visibleWhen } = definition;
  if (visibleWhen === null) return true;
  const target = definitions.find((item) => item.id === visibleWhen.setting);
  if (target === undefined) return false;
  const current = Object.hasOwn(values, target.id)
    ? values[target.id]
    : target.default;
  return current === visibleWhen.equals;
};

/**
 * Разделы формы: настройки сортируются по `order`, затем по порядку
 * объявления; разделы идут в порядке первого вхождения заголовка на языке
 * окна (`resolve`), настройки без `group` составляют первый раздел без
 * заголовка. Скрытые поля и пустые разделы не попадают в результат.
 */
export const buildSettingsSections = (
  definitions: readonly ExtensionSettingDefDto[],
  values: Readonly<ExtensionSettingValuesDto>,
  resolve: (text: LocalizedText) => string,
): SettingsSection[] => {
  const sorted = definitions
    .map((definition, index) => ({ definition, index }))
    .sort(
      (a, b) => a.definition.order - b.definition.order || a.index - b.index,
    )
    .map(({ definition }) => definition)
    .filter((definition) => isSettingVisible(definition, definitions, values));
  const ungrouped = sorted.filter(({ group }) => group === null);
  const sections = new Map<string, ExtensionSettingDefDto[]>();
  for (const definition of sorted) {
    if (definition.group === null) continue;
    const title = resolve(definition.group);
    const fields = sections.get(title) ?? [];
    fields.push(definition);
    sections.set(title, fields);
  }
  return [
    ...(ungrouped.length > 0 ? [{ title: null, fields: ungrouped }] : []),
    ...[...sections].map(([title, fields]) => ({ title, fields })),
  ];
};

/** Подписи поля на языке окна: название, пояснение и названия вариантов `enum`. */
export interface SettingText {
  label: string;
  description: string | null;
  options: { value: string; title: string }[];
}

/** Значения вариантов и самих настроек не переводятся: через `resolve` проходят только подписи. */
export const settingTextOf = (
  definition: ExtensionSettingDefDto,
  resolve: (text: LocalizedText) => string,
): SettingText => ({
  label: resolve(definition.label),
  description:
    definition.description === null ? null : resolve(definition.description),
  options:
    definition.type === 'enum'
      ? definition.options.map((option) => ({
          value: option.value,
          title: resolve(option.label),
        }))
      : [],
});
