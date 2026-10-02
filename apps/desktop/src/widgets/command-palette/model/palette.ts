import { computed, ref, shallowReactive, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { CommandContributionDto } from '@dolphy-app/engine-contract';
import { filterCommands } from '../lib/filter.ts';
import type { PaletteEntry } from '../lib/filter.ts';

export interface CommandPaletteDeps {
  /** Команды включённых расширений; читается реактивно (`contributions-changed`). */
  commands: () => readonly CommandContributionDto[];
  /** Выполняет команду (эффекты и сообщения об ошибках — на стороне вызова). */
  run(command: CommandContributionDto): Promise<void>;
}

export interface CommandPalette {
  readonly isOpen: Readonly<Ref<boolean>>;
  readonly query: Ref<string>;
  readonly entries: ComputedRef<PaletteEntry[]>;
  /** Выбранная строка: держится за ключом команды, а не за позицией. */
  readonly activeKey: Readonly<Ref<string | null>>;
  open(): void;
  close(): void;
  /** Сдвигает выбор на `delta` строк (по кругу). */
  move(delta: number): void;
  activate(key: string): void;
  isBusy(key: string): boolean;
  /** Закрывает палитру и выполняет команду (по умолчанию — выбранную). */
  choose(key?: string): Promise<void>;
}

/**
 * Состояние палитры команд. Выбор переживает обновление вкладов: пока
 * выбранная команда есть, выбор на ней; если пропала — на соседней строке на
 * том же месте. Команда, которая ещё выполняется, повторно не запускается.
 */
export const createCommandPalette = (
  deps: CommandPaletteDeps,
): CommandPalette => {
  const isOpen = ref(false);
  const query = ref('');
  const selectedKey = ref<string | null>(null);
  const busy = shallowReactive(new Set<string>());
  let selectedIndex = 0;

  const entries = computed(() => filterCommands(deps.commands(), query.value));

  const reconcile = (list: readonly PaletteEntry[]) => {
    const found =
      selectedKey.value === null
        ? -1
        : list.findIndex((entry) => entry.key === selectedKey.value);
    if (found >= 0) {
      selectedIndex = found;
      return;
    }
    selectedIndex = Math.min(selectedIndex, Math.max(list.length - 1, 0));
    selectedKey.value = list[selectedIndex]?.key ?? null;
  };

  // синхронно: выбор не должен успеть «прыгнуть» между обновлением и отрисовкой
  watch(entries, reconcile, { flush: 'sync' });
  watch(
    query,
    () => {
      selectedKey.value = null;
      selectedIndex = 0;
      reconcile(entries.value);
    },
    { flush: 'sync' },
  );

  const choose = async (key = selectedKey.value ?? undefined) => {
    const entry = entries.value.find((item) => item.key === key);
    if (entry === undefined || busy.has(entry.key)) return;
    isOpen.value = false;
    busy.add(entry.key);
    try {
      await deps.run(entry.command);
    } finally {
      busy.delete(entry.key);
    }
  };

  return {
    isOpen,
    query,
    entries,
    activeKey: selectedKey,
    open: () => {
      if (isOpen.value) return;
      query.value = '';
      selectedKey.value = null;
      selectedIndex = 0;
      reconcile(entries.value);
      isOpen.value = true;
    },
    close: () => {
      isOpen.value = false;
    },
    move: (delta) => {
      const list = entries.value;
      if (list.length === 0) return;
      const next = (selectedIndex + delta + list.length) % list.length;
      selectedKey.value = list[next]?.key ?? null;
      selectedIndex = next;
    },
    activate: (key) => {
      const index = entries.value.findIndex((entry) => entry.key === key);
      if (index < 0) return;
      selectedKey.value = key;
      selectedIndex = index;
    },
    isBusy: (key) => busy.has(key),
    choose,
  };
};
