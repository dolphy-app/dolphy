import { computed, reactive } from 'vue';
import type { ComputedRef } from 'vue';
import type { BindingSource, SpokenId } from '@dolphy-app/keybindings';
import type { KeybindingEntryDto } from '@dolphy-app/engine-contract';
import { NOT_TYPING_WHEN } from '@/features/app-commands';
import { describeChord } from '@/features/keybindings';
import type { KeybindingsService } from '@/features/keybindings';
import type {
  Command,
  CommandRegistry,
} from '@/shared/lib/command-registry.ts';

/** Привязка в строке таблицы: подпись, озвучивание, условие, источник. */
export interface ShortcutBindingView {
  /** Запись для хранения: по ней редактор находит привязку в наборе команды. */
  entry: KeybindingEntryDto;
  /** По одной подписи на нажатие: цепочка выводится двумя `kbd`. */
  strokes: string[];
  keys: string;
  spoken: string;
  /** Условие в каноническом виде; `null` — без условия. */
  when: string | null;
  source: BindingSource;
}

/** Пересечение привязки строки с привязкой другой команды. */
export interface ShortcutConflictView {
  otherKey: string;
  otherTitle: string;
  /** Подпись клавиш другой команды. */
  otherKeys: string;
  kind: 'same' | 'prefix';
  /** Побеждает привязка этой строки. */
  wins: boolean;
}

export interface ShortcutRow {
  key: string;
  title: string;
  category: string | undefined;
  /** Подпись команды (id расширения); у команд приложения — `undefined`. */
  caption: string | undefined;
  commandSource: Command['source'];
  /** Действующие привязки по убыванию приоритета. */
  bindings: ShortcutBindingView[];
  /** Источник привязок строки для подписи: `user`, если набор задан пользователем; `null` — привязок нет. */
  source: BindingSource | null;
  customized: boolean;
  conflicts: ShortcutConflictView[];
  /** Нижний регистр: название, категория, ключ команды, подписи клавиш — для поиска. */
  haystack: string;
}

export interface ShortcutGroup {
  /** `undefined` — команды без категории (показываются последней группой). */
  category: string | undefined;
  rows: ShortcutRow[];
}

export interface ShortcutFilters {
  query: string;
  /** Только команды с набором пользователя. */
  changedOnly: boolean;
  /** Только команды с пересечениями. */
  conflictsOnly: boolean;
}

export interface ShortcutsInput {
  registry: CommandRegistry;
  keybindings: KeybindingsService;
  /** Слова озвучивания клавиш (`keybinding.*`). */
  word(id: SpokenId): string;
}

/** Все команды окна (приложения и расширений) со своими привязками и пересечениями. */
export const buildShortcutRows = ({
  registry,
  keybindings,
  word,
}: ShortcutsInput): ShortcutRow[] => {
  const commands = registry.list.value;
  const titles = new Map(commands.map(({ key, title }) => [key, title]));
  const { platform } = keybindings;
  const conflictsOf = new Map<string, ShortcutConflictView[]>();
  const addConflict = (key: string, view: ShortcutConflictView) => {
    const list = conflictsOf.get(key);
    if (list === undefined) conflictsOf.set(key, [view]);
    else list.push(view);
  };
  for (const { kind, winner, loser } of keybindings.conflicts.value) {
    const keysOf = (chord: typeof winner.chord) =>
      describeChord(chord, platform, word).keys;
    addConflict(winner.command, {
      otherKey: loser.command,
      otherTitle: titles.get(loser.command) ?? loser.command,
      otherKeys: keysOf(loser.chord),
      kind,
      wins: true,
    });
    addConflict(loser.command, {
      otherKey: winner.command,
      otherTitle: titles.get(winner.command) ?? winner.command,
      otherKeys: keysOf(winner.chord),
      kind,
      wins: false,
    });
  }

  return commands.map((command) => {
    const bindings = keybindings.bindingsFor(command.key).map((binding) => ({
      entry: keybindings.entryOf(binding),
      ...describeChord(binding.chord, platform, word),
      when: binding.whenText,
      source: binding.source,
    }));
    const customized = keybindings.isCustomized(command.key);
    const haystack = [
      command.title,
      command.category,
      command.caption,
      command.key,
      ...bindings.flatMap(({ keys, spoken, entry }) => [
        keys,
        spoken,
        entry.key,
      ]),
    ]
      .join('\n')
      .toLowerCase();
    return {
      key: command.key,
      title: command.title,
      category: command.category,
      caption: command.caption,
      commandSource: command.source,
      bindings,
      source: customized ? 'user' : (bindings[0]?.source ?? null),
      customized,
      conflicts: conflictsOf.get(command.key) ?? [],
      haystack,
    };
  });
};

/**
 * Условие по умолчанию в диалоге: у команды с привязками — условие первой
 * (действующей); у новой привязки команды приложения — «не при вводе текста»;
 * у команды расширения — без условия.
 */
export const defaultWhenOf = (row: ShortcutRow): string => {
  const first = row.bindings[0];
  if (first !== undefined) return first.when ?? '';
  return row.commandSource === 'app' ? NOT_TYPING_WHEN : '';
};

/** Поиск (каждое слово запроса есть в названии, категории, клавишах или ключе команды) и фильтры «изменённые», «с пересечениями». */
export const filterShortcutRows = (
  rows: readonly ShortcutRow[],
  filters: ShortcutFilters,
): ShortcutRow[] => {
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(
    (row) =>
      (!filters.changedOnly || row.customized) &&
      (!filters.conflictsOnly || row.conflicts.length > 0) &&
      terms.every((term) => row.haystack.includes(term)),
  );
};

/** Группы по категориям в порядке регистрации; без категории — последней. */
export const groupShortcutRows = (
  rows: readonly ShortcutRow[],
): ShortcutGroup[] => {
  const groups: ShortcutGroup[] = [];
  for (const row of rows) {
    let group = groups.find(({ category }) => category === row.category);
    if (!group) {
      group = { category: row.category, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups.sort(
    (left, right) =>
      Number(left.category === undefined) -
      Number(right.category === undefined),
  );
};

export interface Shortcuts {
  readonly filters: ShortcutFilters;
  readonly rows: ComputedRef<ShortcutRow[]>;
  /** Группы после поиска и фильтров. */
  readonly groups: ComputedRef<ShortcutGroup[]>;
  /** Число команд с набором пользователя. */
  readonly customizedCount: ComputedRef<number>;
  /** Число команд с пересечениями. */
  readonly conflictCount: ComputedRef<number>;
}

/** Таблица сочетаний: строки следуют за реестром, картой привязок и языком. */
export const useShortcuts = (input: ShortcutsInput): Shortcuts => {
  const filters = reactive<ShortcutFilters>({
    query: '',
    changedOnly: false,
    conflictsOnly: false,
  });
  const rows = computed(() => buildShortcutRows(input));
  const groups = computed(() =>
    groupShortcutRows(filterShortcutRows(rows.value, filters)),
  );
  return {
    filters,
    rows,
    groups,
    customizedCount: computed(
      () => rows.value.filter(({ customized }) => customized).length,
    ),
    conflictCount: computed(
      () => rows.value.filter(({ conflicts }) => conflicts.length > 0).length,
    ),
  };
};
