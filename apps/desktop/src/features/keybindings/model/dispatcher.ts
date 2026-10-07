import { readonly, shallowRef } from 'vue';
import type { Ref } from 'vue';
import { eventToKeystroke } from '@dolphy-app/keybindings';
import type { Chord } from '@dolphy-app/keybindings';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import type { ContextKeys } from '@/shared/lib/context-keys.ts';
import type { KeybindingsService } from './keymap.ts';

/** Сколько окно ждёт второе сочетание цепочки. */
export const CHORD_TIMEOUT_MS = 1500;

/**
 * Область записи сочетания (диалог в «Настройках»): нажатия внутри неё
 * принадлежат рекордеру и командам не отдаются, иначе записать `Mod+K`
 * было бы нельзя.
 */
export const CAPTURE_ATTRIBUTE = 'data-keybinding-capture';
const CAPTURE = `[${CAPTURE_ATTRIBUTE}]`;

/** Таймер вынесен, чтобы тесты управляли временем. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const WINDOW_TIMERS: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as number),
};

export interface KeybindingDispatcherDeps {
  /** Команды: доступность (`enabled`) и выполнение — через реестр, для команд приложения и расширений. */
  registry: CommandRegistry;
  keybindings: Pick<KeybindingsService, 'keymap'>;
  contextKeys: Pick<ContextKeys, 'lookup'>;
  timers?: Timers;
  /** Сбой выполнения команды; по умолчанию — в консоль (команды сами показывают свои сбои). */
  reportFailure?(error: unknown): void;
}

export interface KeybindingDispatcher {
  /** Начало цепочки, пока окно ждёт второе нажатие; иначе `null`. */
  readonly pending: Readonly<Ref<Chord | null>>;
  /** Подписывается на `keydown` документа (фаза перехвата); возвращает снятие. */
  install(doc: Document): () => void;
}

const isPlainEscape = (event: KeyboardEvent): boolean =>
  event.key === 'Escape' &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.shiftKey &&
  !event.metaKey;

/**
 * Единственный обработчик клавиш окна. Игнорирует повтор клавиши, ввод через
 * IME и уже обработанные события; ждёт вторую клавишу цепочки (`Escape`,
 * срок или другая клавиша сбрасывают ожидание, и команда не выполняется);
 * по `Keymap.resolve` выполняет доступную команду; `preventDefault` — только
 * для выполненного сочетания и для ожидания. Палитра — обычная команда.
 */
export const createKeybindingDispatcher = (
  deps: KeybindingDispatcherDeps,
): KeybindingDispatcher => {
  const timers = deps.timers ?? WINDOW_TIMERS;
  const pending = shallowRef<Chord | null>(null);
  let presses: KeyboardEvent[] = [];
  let timer: unknown = null;

  const reset = () => {
    presses = [];
    pending.value = null;
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const run = (key: string) => {
    const command = deps.registry.list.value.find((item) => item.key === key);
    if (command === undefined) return;
    const report =
      deps.reportFailure ??
      ((error: unknown) => console.error({ error }, 'command failed'));
    void (async () => command.run())().catch(report);
  };

  const isEnabled = (key: string): boolean =>
    deps.registry.list.value.some((item) => item.key === key && item.enabled);

  const handle = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (event.target instanceof Element && event.target.closest(CAPTURE)) {
      return;
    }
    // одиночный модификатор не продолжает и не прерывает цепочку
    if (eventToKeystroke(event) === null) return;
    if (presses.length > 0 && isPlainEscape(event)) {
      event.preventDefault();
      reset();
      return;
    }

    const sequence = [...presses, event];
    const resolution = deps.keybindings.keymap.value.resolve(
      sequence,
      deps.contextKeys.lookup(event.target),
      isEnabled,
    );
    if (resolution.kind === 'pending') {
      event.preventDefault();
      reset();
      presses = sequence;
      pending.value = resolution.binding.chord.slice(0, sequence.length);
      timer = timers.set(reset, CHORD_TIMEOUT_MS);
      return;
    }
    reset();
    if (resolution.kind === 'run') {
      event.preventDefault();
      run(resolution.binding.command);
    }
  };

  return {
    pending: readonly(pending),
    install: (doc) => {
      doc.addEventListener('keydown', handle, true);
      return () => {
        doc.removeEventListener('keydown', handle, true);
        reset();
      };
    },
  };
};
