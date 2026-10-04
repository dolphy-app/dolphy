import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
  LearningEngine,
  SafeModeStatusDto,
} from '@dolphy-app/engine-contract';

export type SafeModeBannerKind = 'persisted' | 'flag' | 'env';

export interface SafeModeBanner {
  /** Чем режим включён: запуск (флаг, переменная) сильнее настройки. */
  kind: SafeModeBannerKind;
  /** Кнопка «Выключить» есть только у режима, включённого настройкой: запуском он не снимается. */
  canDisable: boolean;
}

/** Что показывает баннер; `null` — режим выключен (или состояние ещё не прочитано). */
export const bannerOf = (
  status: SafeModeStatusDto | null,
): SafeModeBanner | null => {
  if (status === null || !status.active) return null;
  if (status.forcedBy !== null) {
    return { kind: status.forcedBy, canDisable: false };
  }
  return { kind: 'persisted', canDisable: true };
};

/**
 * Состояние безопасного режима для баннера оболочки. Читается при создании и
 * после каждого изменения настроек расширений и набора вкладов; сбой чтения
 * оставляет прежнее состояние (баннер не появляется из-за сбоя сети движка).
 * `disable` выключает режим настройкой: расширения загружаются сразу.
 */
export const useSafeMode = (engine: LearningEngine) => {
  const status = shallowRef<SafeModeStatusDto | null>(null);
  const disabling = ref(false);
  const failed = ref(false);
  let lastRequest = 0;

  const refresh = async () => {
    lastRequest += 1;
    const request = lastRequest;
    try {
      const { safeMode } = await engine.extensions.diagnostics();
      if (request === lastRequest) status.value = safeMode;
    } catch (error) {
      console.error({ error }, 'safe mode status was not loaded');
    }
  };

  const disable = async () => {
    if (disabling.value) return;
    disabling.value = true;
    failed.value = false;
    try {
      await engine.extensions.setSafeMode(false);
      await refresh();
    } catch {
      failed.value = true;
    } finally {
      disabling.value = false;
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (
      (event.type === 'settings-changed' && event.scope === 'extensions') ||
      event.type === 'contributions-changed'
    ) {
      queueMicrotask(() => void refresh());
    }
  });
  onScopeDispose(unsubscribe);

  void refresh();
  const banner = computed(() => bannerOf(status.value));
  return { banner, disabling, failed, disable, refresh };
};
