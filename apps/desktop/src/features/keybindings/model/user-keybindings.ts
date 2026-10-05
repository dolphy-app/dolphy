import { readonly, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { UserKeybindings } from '@dolphy-app/keybindings';
import type {
  KeybindingsPatch,
  LearningEngine,
} from '@dolphy-app/engine-contract';

/**
 * Пользовательские привязки (`settings.getKeybindings`): единственный
 * источник для окна. Набор команды заменяет её привязки из кода и расширений.
 */
export interface UserKeybindingsStore {
  readonly stored: Readonly<Ref<UserKeybindings>>;
  /**
   * Применяет патч целиком или не применяет (набор команды или `null` —
   * сброс). Отказ движка (`INVALID_ARGUMENT`, `details.reason/field/command/other`)
   * пробрасывается как есть: окно показывает причину.
   */
  save(patch: KeybindingsPatch): Promise<void>;
  /** Движок перезапущен: привязки читаются заново. */
  reconnected(): Promise<void>;
  dispose(): void;
}

export const createUserKeybindings = (
  engine: Pick<LearningEngine, 'subscribe' | 'settings'>,
  initial: UserKeybindings,
): UserKeybindingsStore => {
  const stored = shallowRef<UserKeybindings>(initial);
  let saving = 0;

  const reload = async (): Promise<void> => {
    const next = await engine.settings.getKeybindings();
    // собственная запись ещё идёт: устаревшее чтение её не перебьёт
    if (saving === 0) stored.value = next.commands;
  };

  const reportReload = (error: unknown) =>
    console.error({ error }, 'keybindings were not reloaded');

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'settings-changed' || event.scope !== 'keybindings') {
      return;
    }
    // слушатель не вызывает команды синхронно (API §7)
    queueMicrotask(() => {
      if (saving > 0) return;
      reload().catch(reportReload);
    });
  });

  const save = async (patch: KeybindingsPatch): Promise<void> => {
    saving += 1;
    try {
      stored.value = (await engine.settings.setKeybindings(patch)).commands;
    } finally {
      saving -= 1;
    }
  };

  return {
    stored: readonly(stored),
    save,
    reconnected: () => reload().catch(reportReload),
    dispose: unsubscribe,
  };
};
