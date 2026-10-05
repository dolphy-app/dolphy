import type { Clock } from '../ports/index.ts';

export interface ExpiringMapOptions<T = unknown> {
  capacity: number;
  ttlMs: number;
  clock: Clock;
  /**
   * Запись ушла сама: истёк срок, её вытеснила или заменила новая либо вызван `clear`.
   * Явный `delete` не вызывает: вызывающий сам забрал значение.
   */
  onDrop?: (key: string, value: T) => void;
}

export interface ExpiringMap<T> {
  set(key: string, value: T): void;
  get(key: string): T | undefined;
  delete(key: string): boolean;
  /** Сбрасывает все записи (каждая — через `onDrop`). */
  clear(): void;
  readonly size: number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** Ограниченный реестр: TTL от последней записи, при переполнении вытесняется самая старая. */
export const createExpiringMap = <T>({
  capacity,
  ttlMs,
  clock,
  onDrop,
}: ExpiringMapOptions<T>): ExpiringMap<T> => {
  const entries = new Map<string, Entry<T>>();

  const drop = (key: string, entry: Entry<T>): void => {
    entries.delete(key);
    onDrop?.(key, entry.value);
  };

  const sweep = (): void => {
    const now = clock.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) drop(key, entry);
    }
  };

  const set = (key: string, value: T): void => {
    sweep();
    const replaced = entries.get(key);
    if (replaced !== undefined) drop(key, replaced);
    while (entries.size >= capacity) {
      const oldest = entries.entries().next();
      if (oldest.done) break;
      drop(oldest.value[0], oldest.value[1]);
    }
    entries.set(key, { value, expiresAt: clock.now() + ttlMs });
  };

  const get = (key: string): T | undefined => {
    sweep();
    return entries.get(key)?.value;
  };

  return {
    set,
    get,
    delete: (key) => entries.delete(key),
    clear: () => {
      for (const [key, entry] of [...entries]) drop(key, entry);
    },
    get size() {
      sweep();
      return entries.size;
    },
  };
};
