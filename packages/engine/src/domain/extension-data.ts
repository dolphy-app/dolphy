/**
 * Потолки данных расширения: защита вместо разрешения на хранилище (спека
 * extension-state, R2). Одни и те же числа действуют для хранилища кода
 * расширения и для сохранённых значений настроек; считаются они отдельно.
 */
export const EXTENSION_STORAGE_LIMITS = Object.freeze({
  /** Длина ключа в кодовых единицах UTF-16 (`String.length`). */
  keyLength: 128,
  /** JSON-текст одного значения в байтах UTF-8. */
  valueBytes: 64 * 1024,
  /** Число ключей одного расширения. */
  keys: 256,
  /** Сумма JSON-текстов всех значений одного расширения в байтах UTF-8. */
  totalBytes: 1024 * 1024,
});

/** Потолки одного пространства данных: те же четыре числа, что у `EXTENSION_STORAGE_LIMITS`. */
export type StorageLimits = Readonly<
  Record<'keyLength' | 'valueBytes' | 'keys' | 'totalBytes', number>
>;

/**
 * Потолки секретов расширения (спека extension-api-breadth-1, R6): их проверяет
 * служба по открытому значению. `valueBytes` — открытое значение в байтах
 * UTF-8, не шифртекст.
 */
export const EXTENSION_SECRET_LIMITS = Object.freeze({
  keyLength: 128,
  valueBytes: 4 * 1024,
  keys: 32,
});

/**
 * Потолки пространства секретов в хранилище: там лежит шифртекст (base64 в
 * JSON-строке), он длиннее открытого значения. Запас — вдвое от открытого
 * значения; общий размер потолком не служит (ключей мало).
 */
export const SECRET_STORE_LIMITS: StorageLimits = Object.freeze({
  keyLength: EXTENSION_SECRET_LIMITS.keyLength,
  valueBytes: EXTENSION_SECRET_LIMITS.valueBytes * 2,
  keys: EXTENSION_SECRET_LIMITS.keys,
  totalBytes:
    EXTENSION_SECRET_LIMITS.valueBytes * 2 * EXTENSION_SECRET_LIMITS.keys,
});

/** Какой потолок превышен (`details.kind` ошибки `EXTENSION_STORAGE_QUOTA`). */
export type StorageQuotaKind =
  'key-length' | 'value-size' | 'key-count' | 'total-size';

/** Размер строки в байтах UTF-8 без выделения буфера; непарный суррогат — три байта, как у `TextEncoder` (U+FFFD). */
export const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
};

/** Порядок ключей: по кодовым точкам (он же порядок байтов UTF-8, как `ORDER BY` в SQLite). */
export const compareKeys = (a: string, b: string): number => {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const l = left.next();
    const r = right.next();
    if (l.done === true) return r.done === true ? 0 : -1;
    if (r.done === true) return 1;
    const delta = (l.value.codePointAt(0) ?? 0) - (r.value.codePointAt(0) ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
};

/** JSON-текст значения; `null` — значение не JSON (`undefined`, функция, цикл, `BigInt`). */
export const encodeJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
};

/** Состояние пространства расширения на момент записи. */
export interface StorageSnapshot {
  /** Байты текущего значения ключа; `null` — ключа нет. */
  existingBytes: number | null;
  keys: number;
  totalBytes: number;
}

export interface StorageViolation {
  kind: StorageQuotaKind;
  limit: number;
}

/**
 * Какой потолок нарушит запись `key` ← значение в `valueBytes` байт; `null` —
 * запись допустима. Перезапись ключа число ключей не растит, а общий размер
 * считает без старого значения.
 */
export const findStorageViolation = (
  key: string,
  valueBytes: number,
  snapshot: StorageSnapshot,
  limits: StorageLimits = EXTENSION_STORAGE_LIMITS,
): StorageViolation | null => {
  if (key.length > limits.keyLength) {
    return { kind: 'key-length', limit: limits.keyLength };
  }
  if (valueBytes > limits.valueBytes) {
    return { kind: 'value-size', limit: limits.valueBytes };
  }
  if (snapshot.existingBytes === null && snapshot.keys >= limits.keys) {
    return { kind: 'key-count', limit: limits.keys };
  }
  const total =
    snapshot.totalBytes - (snapshot.existingBytes ?? 0) + valueBytes;
  if (total > limits.totalBytes) {
    return { kind: 'total-size', limit: limits.totalBytes };
  }
  return null;
};
