import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import { displayKeybinding } from '@/shared/lib/keybinding.ts';
import type { Platform } from '@/shared/lib/keybinding.ts';

export interface ShortcutRow {
  key: string;
  title: string;
  /** Подпись клавиш с учётом платформы (`⌘K` или `Ctrl+K`). */
  keys: string;
}

export interface ShortcutGroup {
  /** `undefined` — команды без категории (показываются последней группой). */
  category: string | undefined;
  rows: ShortcutRow[];
}

/**
 * Действующие сочетания из реестра, по категориям (в порядке регистрации).
 * Сочетания команд расширений — только подсказки, приложение их не выполняет,
 * поэтому в список не попадают. Названия и категории читаются реактивно.
 */
export const useShortcutGroups = (
  registry: CommandRegistry,
  platform: Platform,
): ComputedRef<ShortcutGroup[]> =>
  computed(() => {
    const groups: ShortcutGroup[] = [];
    for (const command of registry.list.value) {
      if (command.source !== 'app' || command.keybinding === undefined) {
        continue;
      }
      let group = groups.find(({ category }) => category === command.category);
      if (!group) {
        group = { category: command.category, rows: [] };
        groups.push(group);
      }
      group.rows.push({
        key: command.key,
        title: command.title,
        keys: displayKeybinding(command.keybinding, platform),
      });
    }
    return groups.sort(
      (left, right) =>
        Number(left.category === undefined) -
        Number(right.category === undefined),
    );
  });
