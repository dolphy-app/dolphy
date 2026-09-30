/** Границы бюджета проб, которые принимает `placement.start`. */
export const MIN_BUDGET = 1;
export const MAX_BUDGET = 200;

/** Сколько вопросов задаём по умолчанию, не больше этого числа. */
const DEFAULT_BUDGET_CAP = 20;
/** Проб на урок: с запасом на уточнение границы знаний. */
const PROBES_PER_LESSON = 2;

const clamp = (value: number) =>
  Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.floor(value)));

/** Бюджет по умолчанию: `min(20, уроки * 2)` в пределах 1..200. */
export const defaultBudget = (lessonCount: number) =>
  clamp(Math.min(DEFAULT_BUDGET_CAP, lessonCount * PROBES_PER_LESSON));

/** Верхняя граница выбора бюджета: больше двух проб на урок не нужно. */
export const maxBudget = (lessonCount: number) =>
  clamp(lessonCount * PROBES_PER_LESSON);

/** Бюджет, приведённый к допустимому диапазону. */
export const normalizeBudget = (value: number, lessonCount: number) =>
  Math.min(maxBudget(lessonCount), clamp(Number.isFinite(value) ? value : 0));
