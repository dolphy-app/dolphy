import { onScopeDispose, ref, shallowRef } from 'vue';
import type {
  ContributionTitlesDto,
  ExtensionContributesDto,
  ExtensionHealthDto,
  ExtensionInfoDto,
  ExtensionSettingsDto,
  ExtensionUpdateDto,
  ExtensionsDiagnosticsDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { CONTRIBUTION_POINTS, targetFromUpdate } from '../lib/catalog.ts';
import type { ContributionPoint, InstallTarget } from '../lib/catalog.ts';

export interface ContributionItem {
  id: string;
  /** Текст чипа: название вклада, локализованное событие или сам id. */
  label: string;
  /** Идентификатор по природе (вид задания, язык рендерера) без названия: моноширинный шрифт. */
  mono: boolean;
  /** Такой же текст у другого чипа точки: id нужен и скринридеру. */
  duplicate: boolean;
}

export interface ContributionGroup {
  point: ContributionPoint;
  items: ContributionItem[];
}

type TitlesByPoint = Partial<Record<ContributionPoint, Record<string, string>>>;

const MONO_POINTS: ReadonlySet<ContributionPoint> = new Set([
  'exerciseTypes',
  'markdownRenderers',
]);

/**
 * Непустые группы вкладов расширения в порядке точек. Текст чипа — название
 * из `titles` (если есть), для событий — `eventLabel`, иначе сам id.
 */
export const contributionGroups = (
  contributes: ExtensionContributesDto,
  titles: ContributionTitlesDto = {},
  eventLabel: (name: string) => string = (name) => name,
): ContributionGroup[] =>
  CONTRIBUTION_POINTS.filter((point) => contributes[point].length > 0).map(
    (point) => {
      const titled: Record<string, string> =
        (titles as TitlesByPoint)[point] ?? {};
      const labels = contributes[point].map((id) =>
        point === 'events' ? eventLabel(id) : (titled[id] ?? id),
      );
      const counts = new Map<string, number>();
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return {
        point,
        items: contributes[point].map((id, index) => ({
          id,
          label: labels[index],
          mono: MONO_POINTS.has(point) && titled[id] === undefined,
          duplicate: (counts.get(labels[index]) ?? 0) > 1,
        })),
      };
    },
  );

/**
 * Строка вкладов лишняя, если у расширения единственный вклад — тема, а её
 * название совпадает с названием расширения: карточка уже говорит то же самое.
 */
export const hidesContributions = (
  contributes: ExtensionContributesDto,
  titles: ContributionTitlesDto,
  name: string | null,
): boolean => {
  if (name === null) return false;
  const total = CONTRIBUTION_POINTS.reduce(
    (sum, point) => sum + contributes[point].length,
    0,
  );
  if (total !== 1 || contributes.themes.length !== 1) return false;
  return titles.themes?.[contributes.themes[0]] === name;
};

/** Сколько значений вклада показано, пока группа свёрнута: у расширения до 64 команд, карточка не должна расти без предела. */
export const COLLAPSED_VALUES = 8;

/**
 * Значения группы для показа: свёрнутая группа — первые `limit`, остальное
 * считается в `hidden`; группа не длиннее `limit` не сворачивается вовсе.
 */
export const visibleValues = <T>(
  values: readonly T[],
  expanded: boolean,
  limit = COLLAPSED_VALUES,
): { shown: readonly T[]; hidden: number } =>
  expanded || values.length <= limit
    ? { shown: values, hidden: 0 }
    : { shown: values.slice(0, limit), hidden: values.length - limit };

export type ExtensionsState = 'loading' | 'loaded' | 'failed';

/** Строка здоровья показывается, если расширение сбоило или приостановлено. */
export const hasHealthIssue = (health: ExtensionHealthDto | undefined) =>
  health !== undefined &&
  (health.failures > 0 || health.suppressedUntil !== null);

export type ExtensionSwitch = 'enabled' | 'trusted' | 'notifications';

/** Список настроек, в котором переключатель хранит расширение, и что означает членство (`true` — выключено или доверено). */
const SWITCH_LISTS = {
  enabled: { field: 'disabled', listedWhenOn: false },
  trusted: { field: 'trusted', listedWhenOn: true },
  notifications: { field: 'notificationsOff', listedWhenOn: false },
} as const;

const NO_SETTINGS: ExtensionSettingsDto = {
  disabled: [],
  trusted: [],
  checkUpdates: true,
  safeMode: false,
  notificationsOff: [],
};

/** Метод движка, который записывает переключатель. */
const WRITERS: Record<
  ExtensionSwitch,
  (
    engine: LearningEngine,
    id: string,
    value: boolean,
  ) => Promise<ExtensionSettingsDto>
> = {
  enabled: (engine, id, value) => engine.extensions.setEnabled(id, value),
  trusted: (engine, id, value) => engine.extensions.setTrusted(id, value),
  notifications: (engine, id, value) =>
    engine.extensions.setNotificationsEnabled(id, value),
};

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

export const isEnabled = (settings: ExtensionSettingsDto, id: string) =>
  !settings.disabled.includes(id);

export const isTrusted = (settings: ExtensionSettingsDto, id: string) =>
  settings.trusted.includes(id);

export const areNotificationsOn = (
  settings: ExtensionSettingsDto,
  id: string,
) => !settings.notificationsOff.includes(id);

/** Переключатель «Уведомления» нужен расширению, которое просит разрешение `notifications`. */
export const hasNotifications = (extension: ExtensionInfoDto): boolean =>
  extension.permissions.includes('notifications');

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
 * сбой их чтения не прячет список. `diagnostics` — здоровье расширений и
 * состояние хоста расширений; перечитывается по `extension-health-changed`,
 * его сбой тоже не прячет список. `extensions-changed` и `contributions-changed`
 * (в том числе правка в режиме разработчика, которой `extensions-changed` не
 * сопровождает) перечитывают всё.
 */
export const useExtensions = (engine: LearningEngine) => {
  const items = shallowRef<ExtensionInfoDto[]>([]);
  const updates = shallowRef<ExtensionUpdateDto[]>([]);
  const settings = shallowRef<ExtensionSettingsDto>(NO_SETTINGS);
  const diagnostics = shallowRef<ExtensionsDiagnosticsDto | null>(null);
  const restartingHost = ref(false);
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
      const [list, stored, available, health] = await Promise.all([
        engine.extensions.list(),
        engine.extensions.getSettings(),
        engine.extensions.updates().catch(() => []),
        engine.extensions.diagnostics().catch(() => null),
      ]);
      if (request !== lastRequest) return;
      items.value = list;
      settings.value = stored;
      updates.value = available;
      if (health !== null) diagnostics.value = health;
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
    const { field, listedWhenOn } = SWITCH_LISTS[which];
    // `enabled` и `notifications` хранят выключенные: включить = убрать из списка
    const member = listedWhenOn ? value : !value;
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
      settings.value = await WRITERS[which](engine, id, value);
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

  /** «Безопасный режим»: действует сразу (движок применяет набор до ответа); при отказе откатывается. */
  const setSafeMode = async (value: boolean) => {
    const key = 'safeMode';
    if (switching.value.has(key)) return;
    const previous = settings.value;
    settings.value = { ...previous, safeMode: value };
    switchError.value = null;
    setSwitching(key, true);
    try {
      settings.value = await engine.extensions.setSafeMode(value);
      void load();
    } catch (caught) {
      settings.value = previous;
      switchError.value = errorText(caught);
    } finally {
      setSwitching(key, false);
    }
  };

  /** Здоровье без перечитывания списка: сбой приходит часто и не меняет состав расширений. */
  const loadHealth = async () => {
    try {
      diagnostics.value = await engine.extensions.diagnostics();
    } catch {
      // прежние данные остаются; следующее событие или «Обновить» прочтёт заново
    }
  };

  /** «Перезапустить хост»: хост запускается заново, счётчик его падений обнуляется. */
  const restartHost = async () => {
    if (restartingHost.value) return;
    restartingHost.value = true;
    switchError.value = null;
    try {
      await engine.extensions.restartHost();
      await loadHealth();
    } catch (caught) {
      switchError.value = errorText(caught);
    } finally {
      restartingHost.value = false;
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (
      event.type === 'extensions-changed' ||
      event.type === 'contributions-changed'
    ) {
      queueMicrotask(() => void load());
    } else if (event.type === 'extension-health-changed') {
      queueMicrotask(() => void loadHealth());
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
    diagnostics,
    restartingHost,
    setCheckUpdates,
    setSafeMode,
    restartHost,
    updateTargets,
    setEnabled: (id: string, value: boolean) => change(id, 'enabled', value),
    setTrusted: (id: string, value: boolean) => change(id, 'trusted', value),
    setNotifications: (id: string, value: boolean) =>
      change(id, 'notifications', value),
  };
};
