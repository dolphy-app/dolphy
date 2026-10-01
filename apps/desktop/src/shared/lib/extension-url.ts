/**
 * Адрес модуля расширения для `import()` в окне. Загрузчик ESM кэширует
 * модуль по адресу и не выгружает его, поэтому обновлённый или исправленный
 * (режим разработчика) модуль грузится по новому адресу: ревизия файлов — в
 * запросе. Протокол `dolphy-ext:` запрос игнорирует. У расширений из поставки
 * ревизия пуста, адрес остаётся прежним.
 */
export const moduleUrlOf = (module: {
  rendererUrl: string;
  revision: string;
}): string =>
  module.revision === ''
    ? module.rendererUrl
    : `${module.rendererUrl}?v=${encodeURIComponent(module.revision)}`;
