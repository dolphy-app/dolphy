import type { ExtensionClientDto } from '@dolphy-app/engine-contract';

/**
 * Адрес клиентского модуля расширения для `import()` в окне. Загрузчик ESM
 * кэширует модуль по адресу (и неудачную загрузку тоже) и не выгружает его,
 * поэтому обновлённый или исправленный (режим разработчика) модуль грузится
 * по новому адресу: ревизия файлов — в запросе, номер повторной попытки — в
 * нём же. Протокол `dolphy-ext:` запрос игнорирует. У расширений из поставки
 * ревизия пуста, адрес остаётся прежним.
 */
export const moduleUrlOf = (
  client: Pick<ExtensionClientDto, 'url' | 'revision'>,
  attempt = 0,
): string => {
  const query = [
    ...(client.revision === ''
      ? []
      : [`v=${encodeURIComponent(client.revision)}`]),
    ...(attempt === 0 ? [] : [`retry=${attempt}`]),
  ].join('&');
  return query === '' ? client.url : `${client.url}?${query}`;
};
