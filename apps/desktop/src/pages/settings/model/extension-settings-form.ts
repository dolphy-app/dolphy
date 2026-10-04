import type {
  ExtensionSettingDefDto,
  ExtensionSettingValuesDto,
} from '@dolphy-app/engine-contract';

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
 * объявления; разделы идут в порядке первого вхождения, настройки без `group`
 * составляют первый раздел без заголовка. Скрытые поля и пустые разделы
 * не попадают в результат.
 */
export const buildSettingsSections = (
  definitions: readonly ExtensionSettingDefDto[],
  values: Readonly<ExtensionSettingValuesDto>,
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
    const fields = sections.get(definition.group) ?? [];
    fields.push(definition);
    sections.set(definition.group, fields);
  }
  return [
    ...(ungrouped.length > 0 ? [{ title: null, fields: ungrouped }] : []),
    ...[...sections].map(([title, fields]) => ({ title, fields })),
  ];
};
