const TEEN_FROM = 11;
const TEEN_TO = 19;
const DECIMAL = 10;
const HUNDRED = 100;
const FEW_FROM = 2;
const FEW_TO = 4;
const FOUR_FORMS = 4;

/**
 * Русские формы для vue-i18n: сообщение из четырёх вариантов
 * `ноль | один | несколько | много` («нет задач | {n} задача | {n} задачи |
 * {n} задач»). Если вариантов меньше четырёх, «много» совпадает с
 * «несколько» — так работает и пример из документации vue-i18n.
 */
export const russianPluralRule = (
  choice: number,
  choicesLength: number,
): number => {
  if (choice === 0) return 0;
  const lastTwoDigits = choice % HUNDRED;
  const isTeen = lastTwoDigits >= TEEN_FROM && lastTwoDigits <= TEEN_TO;
  const lastDigit = choice % DECIMAL;
  if (!isTeen && lastDigit === 1) return 1;
  if (!isTeen && lastDigit >= FEW_FROM && lastDigit <= FEW_TO) return 2;
  return choicesLength < FOUR_FORMS ? 2 : 3;
};
