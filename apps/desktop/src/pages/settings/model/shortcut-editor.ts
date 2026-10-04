import { computed, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  chordToText,
  eventToKeystroke,
  formatChord,
  MAX_CHORD_LENGTH,
  validateBinding,
} from '@dolphy-app/keybindings';
import type {
  BindingProblem,
  KeyEventLike,
  Keystroke,
} from '@dolphy-app/keybindings';
import type {
  KeybindingEntryDto,
  KeybindingsPatch,
} from '@dolphy-app/engine-contract';
import { describeSaveFailure } from '@/features/keybindings';
import type { KeybindingsService, SaveFailure } from '@/features/keybindings';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';

/** Что делает рекордер с нажатием. */
export type RecorderStep =
  | { kind: 'cancel' }
  | { kind: 'ignore' }
  | { kind: 'update'; strokes: readonly Keystroke[] };

const MODIFIERS = ['ctrlKey', 'altKey', 'metaKey'] as const;

/**
 * Нажатие в рекордере. `Escape` при пустой записи — отмена; `Backspace` и
 * `Delete` без модификаторов — очистка записи; `Tab` без модификаторов
 * проходит (фокус не запирается в области записи); остальное дописывается
 * к записи, а третье нажатие начинает запись заново. Одиночный модификатор
 * и IME игнорируются.
 */
export const recordKeystroke = (
  strokes: readonly Keystroke[],
  event: KeyEventLike,
): RecorderStep => {
  if (event.isComposing === true) return { kind: 'ignore' };
  const plain = !MODIFIERS.some((name) => event[name]) && !event.shiftKey;
  if (plain && event.key === 'Escape' && strokes.length === 0) {
    return { kind: 'cancel' };
  }
  if (plain && (event.key === 'Backspace' || event.key === 'Delete')) {
    return { kind: 'update', strokes: [] };
  }
  if (event.key === 'Tab' && !MODIFIERS.some((name) => event[name])) {
    return { kind: 'ignore' };
  }
  const stroke = eventToKeystroke(event);
  if (stroke === null) return { kind: 'ignore' };
  return {
    kind: 'update',
    strokes:
      strokes.length >= MAX_CHORD_LENGTH ? [stroke] : [...strokes, stroke],
  };
};

/** Цель диалога: команда и привязка, которую меняют (`null` — добавление). */
export interface EditorTarget {
  command: string;
  title: string;
  previous: KeybindingEntryDto | null;
}

export type EditorProblem =
  BindingProblem | { field: 'key'; reason: 'duplicate' };

/** Пересечение записываемой привязки с привязкой другой команды. */
export interface EditorConflict {
  otherKey: string;
  otherTitle: string;
  kind: 'same' | 'prefix';
  /** Подпись клавиш привязки другой команды (по платформе окна). */
  otherKeys: string;
  /** Привязка другой команды — пользовательская: без переназначения движок отклонит набор. */
  blocking: boolean;
}

export interface ShortcutEditor {
  readonly target: Ref<EditorTarget | null>;
  readonly strokes: Readonly<Ref<readonly Keystroke[]>>;
  readonly when: Ref<string>;
  /** Запись для хранения (`Mod+K Mod+S`); пусто, пока ничего не записано. */
  readonly keyText: ComputedRef<string>;
  readonly problem: ComputedRef<EditorProblem | null>;
  readonly conflicts: ComputedRef<EditorConflict[]>;
  readonly saving: Readonly<Ref<boolean>>;
  /** Отказ движка при сохранении: показывается в диалоге. */
  readonly failure: Readonly<Ref<SaveFailure | null>>;
  /** Отказ движка при снятии привязки или сбросе: показывается над таблицей. */
  readonly actionFailure: Ref<SaveFailure | null>;
  /** Можно сохранять: записано сочетание, нет ошибок проверки, нет сохранения в процессе. */
  readonly canSave: ComputedRef<boolean>;
  open(target: EditorTarget, when: string): void;
  close(): void;
  /**
   * Нажатие в области записи: `cancel` — закрыть диалог, `handled` —
   * записано или очищено (событие гасится), `ignored` — пропустить (Tab,
   * одиночный модификатор).
   */
  press(event: KeyEventLike): 'cancel' | 'handled' | 'ignored';
  clear(): void;
  /** Сохраняет набор команды; `reassign` снимает пересекающиеся привязки у других команд. `true` — сохранено. */
  save(reassign: boolean): Promise<boolean>;
  /** Снимает привязку из набора команды. */
  remove(command: string, entry: KeybindingEntryDto): Promise<void>;
  /** Сбрасывает команду к умолчаниям и вкладам расширений. */
  reset(command: string): Promise<void>;
  resetAll(): Promise<void>;
}

export interface ShortcutEditorDeps {
  registry: CommandRegistry;
  keybindings: KeybindingsService;
}

const sameEntry = (left: KeybindingEntryDto, right: KeybindingEntryDto) =>
  left.key === right.key && left.when === right.when;

export const createShortcutEditor = (
  deps: ShortcutEditorDeps,
): ShortcutEditor => {
  const { keybindings } = deps;
  const { platform } = keybindings;
  const target = ref<EditorTarget | null>(null);
  const strokes = ref<readonly Keystroke[]>([]);
  const when = ref('');
  const saving = ref(false);
  const failure = ref<SaveFailure | null>(null);
  const actionFailure = ref<SaveFailure | null>(null);

  const keyText = computed(() =>
    strokes.value.length === 0 ? '' : chordToText(strokes.value, platform),
  );
  const whenValue = computed(() => {
    const text = when.value.trim();
    return text === '' ? null : text;
  });
  const candidate = computed<KeybindingEntryDto>(() => ({
    key: keyText.value,
    when: whenValue.value,
  }));

  /** Набор команды без заменяемой привязки. */
  const others = computed(() => {
    const current = target.value;
    if (current === null) return [];
    const { previous } = current;
    return keybindings
      .entriesOf(current.command)
      .filter((entry) => previous === null || !sameEntry(entry, previous));
  });

  const problem = computed<EditorProblem | null>(() => {
    if (keyText.value === '') return null;
    const found = validateBinding(candidate.value, [platform]);
    if (found !== null) return found;
    const duplicate = others.value.some((entry) =>
      sameEntry(entry, candidate.value),
    );
    return duplicate ? { field: 'key', reason: 'duplicate' } : null;
  });

  const titles = computed(
    () =>
      new Map<string, string>(
        deps.registry.list.value.map(({ key, title }) => [key, title]),
      ),
  );

  const conflicts = computed<EditorConflict[]>(() => {
    const current = target.value;
    if (current === null || keyText.value === '' || problem.value !== null) {
      return [];
    }
    return keybindings
      .candidateConflicts(current.command, keyText.value, whenValue.value)
      .map(({ kind, other }) => ({
        otherKey: other.command,
        otherTitle: titles.value.get(other.command) ?? other.command,
        kind,
        otherKeys: formatChord(other.chord, platform),
        blocking: other.source === 'user',
      }));
  });

  const canSave = computed(
    () => keyText.value !== '' && problem.value === null && !saving.value,
  );

  const reset = () => {
    strokes.value = [];
    failure.value = null;
    saving.value = false;
  };

  const write = async (patch: KeybindingsPatch) => {
    saving.value = true;
    failure.value = null;
    try {
      await keybindings.save(patch);
      return true;
    } catch (error) {
      failure.value = describeSaveFailure(error);
      return false;
    } finally {
      saving.value = false;
    }
  };

  const act = async (action: () => Promise<void>): Promise<void> => {
    actionFailure.value = null;
    try {
      await action();
    } catch (error) {
      actionFailure.value = describeSaveFailure(error);
    }
  };

  return {
    target,
    strokes,
    when,
    keyText,
    problem,
    conflicts,
    saving,
    failure,
    canSave,
    open: (next, defaultWhen) => {
      reset();
      target.value = next;
      when.value = defaultWhen;
    },
    close: () => {
      target.value = null;
      reset();
    },
    press: (event) => {
      const step = recordKeystroke(strokes.value, event);
      if (step.kind === 'cancel') return 'cancel';
      if (step.kind === 'ignore') return 'ignored';
      strokes.value = step.strokes;
      failure.value = null;
      return 'handled';
    },
    clear: () => {
      strokes.value = [];
    },
    save: async (reassign) => {
      const current = target.value;
      if (current === null || !canSave.value) return false;
      const { previous } = current;
      // замена на месте сохраняет приоритет привязки; добавление — самая сильная
      const entries =
        previous === null
          ? [...others.value, candidate.value]
          : keybindings
              .entriesOf(current.command)
              .map((entry) =>
                sameEntry(entry, previous) ? candidate.value : entry,
              );
      return write(keybindings.buildPatch(current.command, entries, reassign));
    },
    actionFailure,
    remove: (command, entry) =>
      act(() =>
        keybindings.save({
          [command]: keybindings
            .entriesOf(command)
            .filter((item) => !sameEntry(item, entry)),
        }),
      ),
    reset: (command) => act(() => keybindings.reset(command)),
    resetAll: () => act(() => keybindings.resetAll()),
  };
};
