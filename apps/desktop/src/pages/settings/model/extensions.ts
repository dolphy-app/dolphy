import { onScopeDispose, ref, shallowRef } from 'vue';
import type {
  ExtensionContributesDto,
  ExtensionInfoDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { CONTRIBUTION_POINTS, targetFromUpdate } from '../lib/catalog.ts';
import type { ContributionPoint, InstallTarget } from '../lib/catalog.ts';

export interface ContributionGroup {
  point: ContributionPoint;
  values: string[];
}

/** Непустые группы вкладов расширения в порядке точек; значения как есть. */
export const contributionGroups = (
  contributes: ExtensionContributesDto,
): ContributionGroup[] =>
  CONTRIBUTION_POINTS.filter((point) => contributes[point].length > 0).map(
    (point) => ({
      point,
      values: contributes[point],
    }),
  );

/** Сколько значений вклада показано, пока группа свёрнута: у расширения до 64 команд, карточка не должна расти без предела. */
export const COLLAPSED_VALUES = 8;

/**
 * Значения группы для показа: свёрнутая группа — первые `limit`, остальное
 * считается в `hidden`; группа не длиннее `limit` не сворачивается вовсе.
 */
export const visibleValues = (
  values: readonly string[],
  expanded: boolean,
  limit = COLLAPSED_VALUES,
): { shown: readonly string[]; hidden: number } =>
  expanded || values.length <= limit
    ? { shown: values, hidden: 0 }
    : { shown: values.slice(0, limit), hidden: values.length - limit };

export type ExtensionsState = 'loading' | 'loaded' | 'failed';

export type ExtensionSwitch = 'enabled' | 'trusted';

const NO_SETTINGS: ExtensionSettingsDto = {
  disabled: [],
  trusted: [],
  checkUpdates: true,
};

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

export const isEnabled = (settings: ExtensionSettingsDto, id: string) =>
  !settings.disabled.includes(id);

export const isTrusted = (settings: ExtensionSettingsDto, id: string) =>
  settings.trusted.includes(id);

/** Строка с переключателями: не из поставки, действующая (загружена или отключена) и не отозванная. */
export const hasSwitches = (extension: ExtensionInfoDto): boolean =>
  extension.toggleable &&
  extension.revoked === null &&
  (extension.state === 'loaded' || extension.state === 'disabled');

/** Ключ переключателя в списке занятых запросом. */
const switchKey = (id: string, which: ExtensionSwitch) => `${which}:${id}`;

/**
 * Расширения, которые видит движок (`extensions.list`), в порядке движка, и
 * настройки включения и доверия. Повторная загрузка не сбрасывает уже
 * показанный список: `busy` — признак идущего запроса, `state` меняется на
 * `loading` только пока данных нет. Переключатель меняется сразу и
 * откатывается, если движок отказал; изменение действует сразу (движок
 * применяет его до ответа), перезагрузка окна не нужна.
 * `updates` — доступные обновления установленных из каталога расширений;
 * сбой их чтения не прячет список. `extensions-changed` и `contributions-changed`
 * (в том числе правка в режиме разработчика, которой `extensions-changed` не
 * сопровождает) перечитывают всё.
 */
export const useExtensions = (engine: LearningEngine) => {
  const items = shallowRef<ExtensionInfoDto[]>([]);
  const updates = shallowRef<ExtensionUpdateDto[]>([]);
  const settings = shallowRef<ExtensionSettingsDto>(NO_SETTINGS);
  const state = ref<ExtensionsState>('loading');
  const error = ref<string | null>(null);
  const busy = ref(false);
  const switchError = ref<string | null>(null);
  const switching = ref<ReadonlySet<string>>(new Set());
  let lastRequest = 0;

  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    busy.value = true;
    if (state.value === 'failed') state.value = 'loading';
    try {
      const [list, stored, available] = await Promise.all([
        engine.extensions.list(),
        engine.extensions.getSettings(),
        engine.extensions.updates().catch(() => []),
      ]);
      if (request !== lastRequest) return;
      items.value = list;
      settings.value = stored;
      updates.value = available;
      error.value = null;
      state.value = 'loaded';
    } catch (caught) {
      if (request !== lastRequest) return;
      error.value = errorText(caught);
      if (state.value === 'loading') state.value = 'failed';
    } finally {
      if (request === lastRequest) busy.value = false;
    }
  };

  const setSwitching = (key: string, on: boolean) => {
    const next = new Set(switching.value);
    if (on) next.add(key);
    else next.delete(key);
    switching.value = next;
  };

  const optimistic = (
    id: string,
    which: ExtensionSwitch,
    value: boolean,
  ): ExtensionSettingsDto => {
    const current = settings.value;
    const field = which === 'enabled' ? 'disabled' : 'trusted';
    // у `enabled` список хранит отключённые: включить = убрать из списка
    const member = which === 'enabled' ? !value : value;
    const rest = current[field].filter((item) => item !== id);
    return {
      ...current,
      [field]: member ? [...rest, id].sort() : rest,
    };
  };

  const change = async (id: string, which: ExtensionSwitch, value: boolean) => {
    const key = switchKey(id, which);
    if (switching.value.has(key)) return;
    const previous = settings.value;
    settings.value = optimistic(id, which, value);
    switchError.value = null;
    setSwitching(key, true);
    try {
      settings.value =
        which === 'enabled'
          ? await engine.extensions.setEnabled(id, value)
          : await engine.extensions.setTrusted(id, value);
      // список показывает действующие состояние и изоляцию: перечитываем без мигания
      void load();
    } catch (caught) {
      settings.value = previous;
      switchError.value = errorText(caught);
    } finally {
      setSwitching(key, false);
    }
  };

  /** «Проверять обновления при запуске»: меняется сразу, при отказе движка откатывается. */
  const setCheckUpdates = async (value: boolean) => {
    const key = 'checkUpdates';
    if (switching.value.has(key)) return;
    const previous = settings.value;
    settings.value = { ...previous, checkUpdates: value };
    switchError.value = null;
    setSwitching(key, true);
    try {
      settings.value = await engine.extensions.setCheckUpdates(value);
    } catch (caught) {
      settings.value = previous;
      switchError.value = errorText(caught);
    } finally {
      setSwitching(key, false);
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (
      event.type === 'extensions-changed' ||
      event.type === 'contributions-changed'
    ) {
      queueMicrotask(() => void load());
    }
  });
  onScopeDispose(unsubscribe);
  /**
   * Что показать в диалоге обновления: все доступные (`ids` не задан) или
   * выбранные. Вклады и платформы берутся из записи каталога, если индекс
   * доступен.
   */
  const updateTargets = async (
    ids?: readonly string[],
  ): Promise<InstallTarget[]> => {
    const chosen = updates.value.filter(
      ({ id }) => ids === undefined || ids.includes(id),
    );
    if (chosen.length === 0) return [];
    const catalog = await engine.extensions.catalog().catch(() => null);
    return chosen.map((update) =>
      targetFromUpdate(
        update,
        items.value.find(({ id }) => id === update.id),
        catalog?.entries.find(({ id }) => id === update.id),
      ),
    );
  };

  void load();
  return {
    items,
    updates,
    settings,
    state,
    error,
    busy,
    load,
    switching,
    switchError,
    setCheckUpdates,
    updateTargets,
    setEnabled: (id: string, value: boolean) => change(id, 'enabled', value),
    setTrusted: (id: string, value: boolean) => change(id, 'trusted', value),
  };
};
