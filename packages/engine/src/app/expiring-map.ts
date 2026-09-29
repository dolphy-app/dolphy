import type { Clock } from '../ports/index.ts';

export interface ExpiringMapOptions {
  capacity: number;
  ttlMs: number;
  clock: Clock;
}

export interface ExpiringMap<T> {
  set(key: string, value: T): void;
  get(key: string): T | undefined;
  delete(key: string): boolean;
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
}: ExpiringMapOptions): ExpiringMap<T> => {
  const entries = new Map<string, Entry<T>>();

  const sweep = (): void => {
    const now = clock.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };

  const set = (key: string, value: T): void => {
    sweep();
    entries.delete(key);
    while (entries.size >= capacity) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
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
    get size() {
      sweep();
      return entries.size;
    },
  };
};
