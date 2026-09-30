/** Вычисление выбранных индексов без DOM. */

/** Новый выбор после клика: радио заменяет выбор, чекбокс переключает; порядок по возрастанию. */
export const toggleSelection = (
  current: readonly number[],
  index: number,
  multiple: boolean,
): number[] => {
  if (!multiple) return [index];
  const next = current.includes(index)
    ? current.filter((item) => item !== index)
    : [...current, index];
  return next.sort((a, b) => a - b);
};

/** Индексы отмеченных вариантов в порядке `options`. */
export const selectedIndices = (checked: readonly boolean[]): number[] =>
  checked.flatMap((isChecked, index) => (isChecked ? [index] : []));

/** Значение свойства `value` → безопасный список индексов. */
export const normalizeValue = (value: unknown, size: number): number[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is number =>
              Number.isInteger(item) && item >= 0 && item < size,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];
