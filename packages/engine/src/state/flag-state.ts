import type { UnitId } from '@spirula-app/engine-contract';
import type { EntryKey, FlagState } from '../app/context.ts';
import { compareEntryKeys } from './attempt-index.ts';

type FlagName = 'blacklist' | 'review';

interface Decision {
  key: EntryKey;
  set: boolean;
}

/**
 * Blacklist и review list (engine-ts.md §5.2): LWW по ключу
 * `(at, deviceId, seq, id)` — побеждает запись с наибольшим ключом, поэтому
 * порядок прихода не важен. Порядок списка — ключ победившей записи `set`
 * (порядок добавления). Наследование курс → урок → упражнение считает
 * вызывающий (`BlacklistView` — прямое членство).
 */
export const createFlagState = (): FlagState => {
  const decisions: Record<FlagName, Map<UnitId, Decision>> = {
    blacklist: new Map(),
    review: new Map(),
  };
  const listed: Record<FlagName, UnitId[] | null> = {
    blacklist: null,
    review: null,
  };

  const apply: FlagState['apply'] = (entry) => {
    const map = decisions[entry.flag];
    const known = map.get(entry.unitId);
    if (known !== undefined && compareEntryKeys(known.key, entry) >= 0) {
      return false;
    }
    const { at, deviceId, seq, id } = entry;
    map.set(entry.unitId, {
      key: { at, deviceId, seq, id },
      set: entry.op === 'set',
    });
    listed[entry.flag] = null;
    return true;
  };

  const has: FlagState['has'] = (flag, unitId) =>
    decisions[flag].get(unitId)?.set === true;

  const list: FlagState['list'] = (flag) => {
    const cached = listed[flag];
    if (cached !== null) return cached;
    const entries = [...decisions[flag]].filter(([, { set }]) => set);
    entries.sort(
      ([idA, a], [idB, b]) =>
        compareEntryKeys(a.key, b.key) || Number(idA > idB) - Number(idA < idB),
    );
    const units = entries.map(([unitId]) => unitId);
    listed[flag] = units;
    return units;
  };

  const clear = () => {
    for (const flag of ['blacklist', 'review'] as const) {
      decisions[flag].clear();
      listed[flag] = null;
    }
  };

  return {
    apply,
    has,
    list,
    isBlacklisted: (unitId) => has('blacklist', unitId),
    entries: () => list('review'),
    clear,
  };
};
