import { computed, inject, shallowReactive, toValue, watch } from 'vue';
import type { ComputedRef, InjectionKey, MaybeRefOrGetter } from 'vue';
import { parseKeybinding } from './keybinding.ts';

export type CommandSource = 'app' | 'extension';

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
  description?: string;
  /** Подпись рядом с названием (у команд расширений — id расширения). */
  caption?: string;
  /**
   * Сочетание клавиш (`Mod+Shift+L`). У команд приложения — действующее и
   * проверяется при регистрации; у команд расширений — подсказка как есть.
   */
  keybinding?: string;
  /** Вариант выбран (текущая тема, язык). */
  checked?: MaybeRefOrGetter<boolean>;
  /** Команда сейчас доступна; по умолчанию да. */
  enabled?: MaybeRefOrGetter<boolean>;
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
  readonly keybinding: string | undefined;
  readonly checked: boolean;
  readonly enabled: boolean;
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
  description: descriptor.description,
  caption: descriptor.caption,
  keybinding: descriptor.keybinding,
  checked: toValue(descriptor.checked) ?? false,
  enabled: toValue(descriptor.enabled) ?? true,
  run: descriptor.run,
});

export const createCommandRegistry = (): CommandRegistry => {
  const descriptors = shallowReactive(new Map<string, CommandDescriptor>());
  const list = computed(() => [...descriptors.values()].map(resolve));

  const register = (descriptor: CommandDescriptor): (() => void) => {
    if (descriptors.has(descriptor.key)) {
      throw new Error(`command "${descriptor.key}" is already registered`);
    }
    if (descriptor.source === 'app' && descriptor.keybinding !== undefined) {
      parseKeybinding(descriptor.keybinding);
    }
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
