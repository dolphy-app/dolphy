import type {
  ExtensionHealthDto,
  ExtensionHostStatusDto,
} from '@dolphy-app/engine-contract';
import type { Clock, ExtensionHealth } from '../ports/index.ts';

type Entry = Omit<ExtensionHealthDto, 'id'>;

const fresh = (): Entry => ({
  failures: 0,
  lastFailure: null,
  lastActivationMs: null,
  suppressedUntil: null,
});

/**
 * Здоровье расширений в памяти. Запись создаётся при первом событии; `get`
 * для не сбоивших отдаёт нули. Слушатели вызываются синхронно после каждого
 * изменения; исключение слушателя не прерывает остальных.
 */
export const createExtensionHealth = (clock: Clock): ExtensionHealth => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let host: ExtensionHostStatusDto = 'running';

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // слушатель только публикует событие; его отказ не должен ломать учёт
      }
    }
  };
  const entry = (extensionId: string): Entry => {
    let found = entries.get(extensionId);
    if (found === undefined) {
      found = fresh();
      entries.set(extensionId, found);
    }
    return found;
  };

  return {
    recordFailure(extensionId, reason, message) {
      const item = entry(extensionId);
      // отказ приостановленному расширению — следствие приостановки, а не новый сбой
      if (item.suppressedUntil !== null && item.suppressedUntil > clock.now()) {
        return;
      }
      item.failures += 1;
      item.lastFailure = { at: clock.now(), reason, message };
      notify();
    },
    recordActivation(extensionId, durationMs) {
      entry(extensionId).lastActivationMs = Math.max(0, Math.round(durationMs));
      notify();
    },
    recordSuppression(extensionId, until) {
      entry(extensionId).suppressedUntil = until;
      notify();
    },
    forget(extensionId) {
      if (entries.delete(extensionId)) notify();
    },
    get(extensionId) {
      const item = entries.get(extensionId) ?? fresh();
      const { suppressedUntil } = item;
      return {
        id: extensionId,
        failures: item.failures,
        lastFailure: item.lastFailure === null ? null : { ...item.lastFailure },
        lastActivationMs: item.lastActivationMs,
        suppressedUntil:
          suppressedUntil !== null && suppressedUntil > clock.now()
            ? suppressedUntil
            : null,
      };
    },
    hostStatus: () => host,
    setHostStatus(status) {
      if (host === status) return;
      host = status;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};
