/**
 * Нормализация входа `repositories.add`: URL репозитория, короткое имя
 * ветки или тега и `id` — slug URL. Всё чистое и без сети: неверный вход
 * отвергается до обращения к серверу (R3).
 */
import { EngineError } from './errors.ts';

const MAX_SLUG_LENGTH = 80;
const MAX_REF_LENGTH = 255;

/** Пробелы, управляющие символы и символы, запрещённые в именах ссылок git (`git check-ref-format`). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_REF_CHARS = /[\s\u0000-\u001f\u007f~^:?*[\\]/;

const invalid = (field: 'url' | 'ref', message: string): EngineError =>
  new EngineError('INVALID_ARGUMENT', { message, details: { field } });

/**
 * Нормализованный URL — ключ уникальности: схема `http(s)`, хост в нижнем
 * регистре без порта по умолчанию, без хвостовых `/` и `.git`, без фрагмента.
 * Логин, пароль и query-строка в адресе отвергаются.
 */
export const normalizeRepositoryUrl = (input: unknown): string => {
  if (typeof input !== 'string') {
    throw invalid('url', 'Repository URL must be a string');
  }
  const text = input.trim();
  if (text === '') throw invalid('url', 'Repository URL is empty');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid('url', 'Repository URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('url', 'Repository URL must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw invalid('url', 'Repository URL must not contain credentials');
  }
  if (url.hostname === '') throw invalid('url', 'Repository URL has no host');
  if (url.search !== '') {
    throw invalid('url', 'Repository URL must not contain a query string');
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
};

/** Короткое имя ветки или тега; `undefined`, `null` и пустая строка — ветка по умолчанию. */
export const normalizeRepositoryRef = (input: unknown): string | null => {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') {
    throw invalid('ref', 'Repository ref must be a string');
  }
  if (input.length > MAX_REF_LENGTH) {
    throw invalid('ref', 'Repository ref is too long');
  }
  const bad =
    FORBIDDEN_REF_CHARS.test(input) ||
    input.includes('..') ||
    input.includes('//') ||
    input.includes('@{') ||
    input.startsWith('-') ||
    input.startsWith('/') ||
    input.endsWith('/') ||
    input.endsWith('.') ||
    input.endsWith('.lock');
  if (bad) throw invalid('ref', 'Repository ref is not a valid branch or tag');
  return input;
};

/**
 * `id` репозитория по нормализованному URL: хост и сегменты пути через `-`,
 * `[a-z0-9._-]`, без ведущей точки (сканер пропускает каталоги с точкой).
 */
export const repositorySlug = (normalizedUrl: string): string => {
  const decodeSegment = (segment: string): string => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment; // битая последовательность `%`: sanitize заменит её на `-`
    }
  };
  const url = new URL(normalizedUrl);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  const parts = [url.host, ...segments];
  const slug = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/[-.]+$/, '');
  return slug === '' ? 'repository' : slug;
};

/** Первые 8 hex SHA-1 URL: суффикс `id` при совпадении slug у разных URL. */
export const urlHash8 = async (normalizedUrl: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(normalizedUrl),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  )
    .join('')
    .slice(0, 8);
};
