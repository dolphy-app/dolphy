import { ref, shallowRef } from 'vue';
import type {
  ExtensionContributesDto,
  ExtensionInfoDto,
  ExtensionSettingsDto,
  LearningEngine,
} from '@spirula/engine-contract';

export type ContributionPoint = keyof ExtensionContributesDto;

export interface ContributionGroup {
  point: ContributionPoint;
  values: string[];
}

const POINT_ORDER: readonly ContributionPoint[] = [
  'exerciseTypes',
  'themes',
  'markdownRenderers',
  'gradePolicies',
];

/** Непустые группы вкладов расширения в порядке точек; значения как есть. */
export const contributionGroups = (
  contributes: ExtensionContributesDto,
): ContributionGroup[] =>
  POINT_ORDER.filter((point) => contributes[point].length > 0).map((point) => ({
    point,
    values: contributes[point],
  }));

export type ExtensionsState = 'loading' | 'loaded' | 'failed';

export type ExtensionSwitch = 'enabled' | 'trusted';

const NO_SETTINGS: ExtensionSettingsDto = { disabled: [], trusted: [] };

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

export const isEnabled = (settings: ExtensionSettingsDto, id: string) =>
  !settings.disabled.includes(id);

export const isTrusted = (settings: ExtensionSettingsDto, id: string) =>
  settings.trusted.includes(id);

/** Строка с переключателями: не из поставки и действующая (загружена или отключена). */
export const hasSwitches = (extension: ExtensionInfoDto): boolean =>
  extension.toggleable &&
  (extension.state === 'loaded' || extension.state === 'disabled');

/** Ключ переключателя в списке занятых запросом. */
const switchKey = (id: string, which: ExtensionSwitch) => `${which}:${id}`;

/**
 * Расширения, которые видит движок (`extensions.list`), в порядке движка, и
 * настройки включения и доверия. Повторная загрузка не сбрасывает уже
 * показанный список: `busy` — признак идущего запроса, `state` меняется на
 * `loading` только пока данных нет. Переключатель меняется сразу и
 * откатывается, если движок отказал; вклады расширений читаются при запуске,
 * поэтому после успешного изменения `needsReload` просит перезагрузить окно.
 */
export const useExtensions = (engine: LearningEngine) => {
  const items = shallowRef<ExtensionInfoDto[]>([]);
  const settings = shallowRef<ExtensionSettingsDto>(NO_SETTINGS);
  const state = ref<ExtensionsState>('loading');
  const error = ref<string | null>(null);
  const busy = ref(false);
  const switchError = ref<string | null>(null);
  const needsReload = ref(false);
  const switching = ref<ReadonlySet<string>>(new Set());
  let lastRequest = 0;

  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    busy.value = true;
    if (state.value === 'failed') state.value = 'loading';
    try {
      const [list, stored] = await Promise.all([
        engine.extensions.list(),
        engine.extensions.getSettings(),
      ]);
      if (request !== lastRequest) return;
      items.value = list;
      settings.value = stored;
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
      needsReload.value = true;
      // список показывает действующие состояние и изоляцию: перечитываем без мигания
      void load();
    } catch (caught) {
      settings.value = previous;
      switchError.value = errorText(caught);
    } finally {
      setSwitching(key, false);
    }
  };

  void load();
  return {
    items,
    settings,
    state,
    error,
    busy,
    load,
    switching,
    switchError,
    needsReload,
    setEnabled: (id: string, value: boolean) => change(id, 'enabled', value),
    setTrusted: (id: string, value: boolean) => change(id, 'trusted', value),
  };
};
