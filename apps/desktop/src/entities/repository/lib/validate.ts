/** Причина отказа предпроверки; ключ сообщения — `repository.validation.<причина>`. */
export type UrlIssue =
  'url-empty' | 'url-invalid' | 'url-scheme' | 'url-credentials';
export type RefIssue = 'ref-spaces' | 'ref-dotdot';

/**
 * Предпроверка URL по тем же правилам, что у движка (R3): `http(s)`, без
 * логина и пароля. Сеть не трогает; `null` — URL годится.
 */
export const validateRepositoryUrl = (input: string): UrlIssue | null => {
  const text = input.trim();
  if (text === '') return 'url-empty';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'url-invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'url-scheme';
  }
  if (url.username !== '' || url.password !== '') return 'url-credentials';
  if (url.hostname === '') return 'url-invalid';
  return null;
};

/** Пустой `ref` допустим (ветка по умолчанию); пробелы и `..` — нет. */
export const validateRepositoryRef = (input: string): RefIssue | null => {
  const text = input.trim();
  if (text === '') return null;
  if (/\s/u.test(text)) return 'ref-spaces';
  if (text.includes('..')) return 'ref-dotdot';
  return null;
};
