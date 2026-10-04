import { computed, inject, shallowReactive, toValue, watch } from 'vue';
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue';
import { PLATFORMS, validateBinding } from '@dolphy-app/keybindings';
import type { BindingDefinition } from '@dolphy-app/keybindings';

export type CommandSource = 'app' | 'extension';

/**
 * Привязка команды по умолчанию: `key` — запись (`Mod+Shift+L`, цепочка
 * `Mod+K Mod+S`), `mac`/`windows`/`linux` заменяют её на своей платформе,
 * `when` — условие (контекстные ключи окна). Формат — пакет `@dolphy-app/keybindings`.
 */
export type DefaultBinding = Omit<BindingDefinition, 'command'>;

/**
 * Описание команды при регистрации. Поля со значением `MaybeRefOrGetter`
 * читаются при каждом чтении списка: название и пометки следуют за языком и
 * выбором без повторной регистрации.
 */
export interface CommandDescriptor {
  /** Уникален в окне: `app:<id>` или `extension:<extensionId>:<id>`. */
  key: string;
  source: CommandSource;
  title: MaybeRefOrGetter<string>;
  category?: MaybeRefOrGetter<string | undefined>;
  description?: MaybeRefOrGetter<string | undefined>;
  /** Подпись рядом с названием (у команд расширений — id расширения). */
  caption?: string;
  /**
   * Привязки по умолчанию. Только у команд приложения: проверяются при
   * регистрации на всех платформах (ошибка — ошибка программиста). Привязки
   * команд расширений идут из их вкладов отдельным списком.
   */
  keybindings?: DefaultBinding[];
  /** Вариант выбран (текущая тема, язык). */
  checked?: MaybeRefOrGetter<boolean>;
  /** Команда сейчас доступна; по умолчанию да. */
  enabled?: MaybeRefOrGetter<boolean>;
  /** Показывать в палитре; `false` — только сочетание клавиш и раздел сочетаний (по умолчанию да). */
  listed?: boolean;
  run(): void | Promise<void>;
}

/** Команда, как её видит читатель: все значения вычислены на момент чтения. */
export interface Command {
  readonly key: string;
  readonly source: CommandSource;
  readonly title: string;
  readonly category: string | undefined;
  readonly description: string | undefined;
  readonly caption: string | undefined;
  /** Привязки по умолчанию; действующие читают у карты привязок (`features/keybindings`). */
  readonly defaultBindings: readonly DefaultBinding[];
  /** `undefined` — команда не из набора вариантов; иначе выбран ли вариант. */
  readonly checked: boolean | undefined;
  readonly enabled: boolean;
  readonly listed: boolean;
  run(): void | Promise<void>;
}

export interface CommandRegistry {
  /** Все зарегистрированные команды в порядке регистрации; пересчитывается реактивно. */
  readonly list: ComputedRef<readonly Command[]>;
  /** Повторная регистрация ключа — ошибка; возвращает идемпотентную отмену. */
  register(descriptor: CommandDescriptor): () => void;
}

export const COMMAND_REGISTRY_KEY: InjectionKey<CommandRegistry> =
  Symbol('command-registry');

export const useCommandRegistry = (): CommandRegistry => {
  const registry = inject(COMMAND_REGISTRY_KEY);
  if (!registry) throw new Error('command registry is not provided');
  return registry;
};

const resolve = (descriptor: CommandDescriptor): Command => ({
  key: descriptor.key,
  source: descriptor.source,
  title: toValue(descriptor.title),
  category: toValue(descriptor.category),
  description: toValue(descriptor.description),
  caption: descriptor.caption,
  defaultBindings: descriptor.keybindings ?? [],
  checked: toValue(descriptor.checked),
  enabled: toValue(descriptor.enabled) ?? true,
  listed: descriptor.listed ?? true,
  run: descriptor.run,
});

/** Привязка по умолчанию неверна на какой-то платформе: опечатка в коде не должна молча остаться без сочетания. */
const assertBindings = (descriptor: CommandDescriptor): void => {
  for (const binding of descriptor.keybindings ?? []) {
    for (const platform of PLATFORMS) {
      const problem = validateBinding(
        { key: binding[platform] ?? binding.key, when: binding.when ?? null },
        [platform],
      );
      if (problem !== null) {
        throw new Error(
          `invalid keybinding of "${descriptor.key}" (${platform}): ${problem.field} ${problem.detail}`,
        );
      }
    }
  }
};

/** Привязки по умолчанию команд приложения: вход карты привязок (`defaults`). */
export const defaultBindingsOf = (
  commands: readonly Command[],
): BindingDefinition[] =>
  commands
    .filter(({ source }) => source === 'app')
    .flatMap(({ key, defaultBindings }) =>
      defaultBindings.map((binding) => ({ ...binding, command: key })),
    );

export const createCommandRegistry = (): CommandRegistry => {
  const descriptors = shallowReactive(new Map<string, CommandDescriptor>());
  const list = computed(() => [...descriptors.values()].map(resolve));

  const register = (descriptor: CommandDescriptor): (() => void) => {
    if (descriptors.has(descriptor.key)) {
      throw new Error(`command "${descriptor.key}" is already registered`);
    }
    if (descriptor.source === 'app') assertBindings(descriptor);
    descriptors.set(descriptor.key, descriptor);
    return () => {
      // отмена устаревшей записи не снимает новую с тем же ключом
      if (descriptors.get(descriptor.key) === descriptor) {
        descriptors.delete(descriptor.key);
      }
    };
  };

  return { list, register };
};

export interface SyncedCommand {
  descriptor: CommandDescriptor;
  /** Меняется, когда запись нужно зарегистрировать заново (данные команды изменились). */
  revision: string;
}

/**
 * Держит в реестре набор команд, который описывает `source`: новые ключи
 * регистрируются, пропавшие снимаются, у записи с новой `revision` описание
 * заменяется. Синхронно, чтобы читатели не видели промежуточных состояний.
 * Возвращает остановку; она же снимает все записи.
 */
export const syncCommands = (
  registry: CommandRegistry,
  source: () => readonly SyncedCommand[],
): (() => void) => {
  const active = new Map<string, { revision: string; dispose(): void }>();

  const stop = watch(
    source,
    (next) => {
      const wanted = new Set(next.map(({ descriptor }) => descriptor.key));
      for (const [key, entry] of active) {
        if (!wanted.has(key)) {
          entry.dispose();
          active.delete(key);
        }
      }
      for (const { descriptor, revision } of next) {
        const current = active.get(descriptor.key);
        if (current?.revision === revision) continue;
        current?.dispose();
        active.set(descriptor.key, {
          revision,
          dispose: registry.register(descriptor),
        });
      }
    },
    { immediate: true, flush: 'sync' },
  );

  return () => {
    stop();
    for (const entry of active.values()) entry.dispose();
    active.clear();
  };
};
