import { computed, inject } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';
import {
  buildKeymap,
  chordToText,
  findCandidateConflicts,
  tryParseChord,
  tryParseWhen,
} from '@dolphy-app/keybindings';
import type {
  Binding,
  BindingDefinition,
  Conflict,
  Keymap,
  Platform,
  UserKeybindings,
} from '@dolphy-app/keybindings';
import type {
  KeybindingEntryDto,
  KeybindingsPatch,
} from '@dolphy-app/engine-contract';
import { defaultBindingsOf } from '@/shared/lib/command-registry.ts';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import type { UserKeybindingsStore } from './user-keybindings.ts';

/** Пересечение кандидата с привязкой другой команды. */
export interface CandidateConflict {
  readonly kind: Conflict['kind'];
  /** Привязка другой команды. */
  readonly other: Binding;
}

export interface KeybindingsService {
  readonly platform: Platform;
  /** Карта действующих привязок: умолчания команд приложения, вклады расширений, набор пользователя. */
  readonly keymap: ComputedRef<Keymap>;
  readonly user: Readonly<Ref<UserKeybindings>>;
  /** Привязки команды по убыванию приоритета. */
  bindingsFor(commandKey: string): readonly Binding[];
  /** Привязка наивысшего приоритета: её показывают палитра и подсказки. */
  primary(commandKey: string): Binding | undefined;
  /** У команды есть набор пользователя (он заменяет умолчания). */
  isCustomized(commandKey: string): boolean;
  readonly conflicts: ComputedRef<readonly Conflict[]>;
  /** Запись для хранения: клавиши в каноническом виде, условие как в карте. */
  entryOf(binding: Binding): KeybindingEntryDto;
  /** Действующие привязки команды как набор пользователя, в порядке возрастания приоритета. */
  entriesOf(commandKey: string): KeybindingEntryDto[];
  /**
   * Пересечения кандидата с привязками других команд, до сохранения;
   * непонятная запись или условие — пустой список (её покажет проверка).
   */
  candidateConflicts(
    commandKey: string,
    key: string,
    when: string | null,
  ): CandidateConflict[];
  /**
   * Патч «записать набор `entries` команде» и, при `reassign`, «снять
   * пересекающиеся привязки у других команд»: их наборы пишутся без
   * пересекающихся записей в том же патче (движок применяет его целиком).
   */
  buildPatch(
    commandKey: string,
    entries: readonly KeybindingEntryDto[],
    reassign: boolean,
  ): KeybindingsPatch;
  save(patch: KeybindingsPatch): Promise<void>;
  /** Сброс команды: набор пользователя удаляется, действуют умолчания и вклады. */
  reset(commandKey: string): Promise<void>;
  resetAll(): Promise<void>;
}

export interface KeybindingsServiceDeps {
  registry: CommandRegistry;
  user: Pick<UserKeybindingsStore, 'stored' | 'save'>;
  /** Привязки команд расширений (`syncExtensionCommands`); читается реактивно. */
  extensionBindings: () => readonly BindingDefinition[];
  platform: Platform;
}

export const KEYBINDINGS_KEY: InjectionKey<KeybindingsService> =
  Symbol('keybindings');

export const useKeybindings = (): KeybindingsService => {
  const service = inject(KEYBINDINGS_KEY);
  if (!service) throw new Error('keybindings are not provided');
  return service;
};

export const createKeybindingsService = (
  deps: KeybindingsServiceDeps,
): KeybindingsService => {
  const { platform, user } = deps;

  const keymap = computed(() =>
    buildKeymap({
      platform,
      defaults: defaultBindingsOf(deps.registry.list.value),
      extensions: deps.extensionBindings(),
      user: user.stored.value,
    }),
  );
  const conflicts = computed(() => keymap.value.conflicts());

  const bindingsFor = (commandKey: string) =>
    keymap.value.forCommand(commandKey);

  const entryOf = (binding: Binding): KeybindingEntryDto => ({
    key: chordToText(binding.chord, platform),
    when: binding.whenText,
  });

  const entriesOf = (commandKey: string): KeybindingEntryDto[] =>
    bindingsFor(commandKey).map(entryOf).reverse();

  const candidateConflicts = (
    commandKey: string,
    key: string,
    when: string | null,
  ): CandidateConflict[] => {
    const chord = tryParseChord(key, platform);
    const text = when?.trim() ?? '';
    const parsed = text === '' ? null : tryParseWhen(text);
    if (chord === null || (text !== '' && parsed === null)) return [];
    return findCandidateConflicts(keymap.value, {
      command: commandKey,
      chord,
      when: parsed,
    }).map(({ kind, loser }) => ({ kind, other: loser }));
  };

  const buildPatch = (
    commandKey: string,
    entries: readonly KeybindingEntryDto[],
    reassign: boolean,
  ): KeybindingsPatch => {
    const patch: KeybindingsPatch = { [commandKey]: [...entries] };
    if (!reassign) return patch;
    const taken = new Set<Binding>();
    for (const { key, when } of entries) {
      for (const { other } of candidateConflicts(commandKey, key, when)) {
        taken.add(other);
      }
    }
    for (const binding of taken) {
      const rest = bindingsFor(binding.command).filter(
        (item) => !taken.has(item),
      );
      patch[binding.command] = rest.map(entryOf).reverse();
    }
    return patch;
  };

  const save = (patch: KeybindingsPatch) => user.save(patch);

  return {
    platform,
    keymap,
    user: user.stored,
    bindingsFor,
    primary: (commandKey) => bindingsFor(commandKey)[0],
    isCustomized: (commandKey) => Object.hasOwn(user.stored.value, commandKey),
    conflicts,
    entryOf,
    entriesOf,
    candidateConflicts,
    buildPatch,
    save,
    reset: (commandKey) => save({ [commandKey]: null }),
    resetAll: async () => {
      const keys = Object.keys(user.stored.value);
      if (keys.length === 0) return;
      await save(Object.fromEntries(keys.map((key) => [key, null])));
    },
  };
};
