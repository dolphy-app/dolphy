import { onScopeDispose, ref, shallowRef } from 'vue';
import type {
  ExtensionSettingDefDto,
  ExtensionSettingValuesDto,
  JsonValue,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { toEngineError } from '@/entities/repository';

export type ExtensionSettingsState = 'loading' | 'loaded' | 'failed';

/** Причины отказа движка (`details.reason` ошибки `INVALID_ARGUMENT`) и локальная проверка ввода. */
export const SETTING_PROBLEMS = [
  'type',
  'integer',
  'range',
  'max-length',
  'option',
  'format',
  'max-items',
  'unknown-setting',
  'not-a-number',
] as const;

export type SettingProblem = (typeof SETTING_PROBLEMS)[number];

/**
 * Отказ записи значения: `reason` — известная причина (окно подбирает по ней
 * понятный текст), `message` — сообщение движка как есть.
 */
export interface SettingError {
  reason: SettingProblem | null;
  message: string;
}

const isProblem = (value: unknown): value is SettingProblem =>
  SETTING_PROBLEMS.some((problem) => problem === value);

export const toSettingError = (caught: unknown): SettingError => {
  const error = toEngineError(caught);
  const reason = error.details?.['reason'];
  return {
    reason: isProblem(reason) ? reason : null,
    message: error.message,
  };
};

/** Значение поля ввода числа; `null` — не число (пусто, мусор, бесконечность). */
export const parseNumberInput = (input: string): number | null => {
  const text = input.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * Определения и значения настроек одного включённого расширения. Значение
 * меняется в форме сразу и откатывается, если движок его отклонил: причина
 * остаётся в `errors` под полем. Изменения, пришедшие от движка
 * (`settings-changed` с областью `extensionValues`, сброс, очистка данных,
 * другое окно), обновляют значения без участия формы; пока идёт запись, ответ
 * записи считается более свежим, чем перечитанное.
 */
export const useExtensionSettings = (
  engine: LearningEngine,
  extensionId: string,
) => {
  const definitions = shallowRef<readonly ExtensionSettingDefDto[]>([]);
  const values = shallowRef<Readonly<ExtensionSettingValuesDto>>({});
  const state = ref<ExtensionSettingsState>('loading');
  const loadError = ref<string | null>(null);
  const errors = shallowRef<Readonly<Record<string, SettingError>>>({});
  const saving = ref<ReadonlySet<string>>(new Set());
  const resetting = ref(false);
  const resetError = ref<string | null>(null);
  let lastRequest = 0;
  const lastWrite = new Map<string, number>();

  const setError = (settingId: string, error: SettingError | null) => {
    const next = { ...errors.value };
    if (error === null) delete next[settingId];
    else next[settingId] = error;
    errors.value = next;
  };

  const setSaving = (settingId: string, on: boolean) => {
    const next = new Set(saving.value);
    if (on) next.add(settingId);
    else next.delete(settingId);
    saving.value = next;
  };

  const load = async () => {
    lastRequest += 1;
    const request = lastRequest;
    if (state.value === 'failed') state.value = 'loading';
    try {
      const [contributions, current] = await Promise.all([
        engine.extensions.contributions(),
        engine.extensions.getSettingValues(extensionId),
      ]);
      if (request !== lastRequest) return;
      definitions.value = contributions.settings.filter(
        (definition) => definition.extensionId === extensionId,
      );
      if (saving.value.size === 0) values.value = current;
      loadError.value = null;
      state.value = 'loaded';
    } catch (caught) {
      if (request !== lastRequest) return;
      loadError.value = errorText(caught);
      state.value = 'failed';
    }
  };

  /**
   * Записывает значение. `true` — движок принял его; иначе значение
   * возвращено прежним, отказ записан в `errors`.
   */
  const set = async (
    settingId: string,
    value: JsonValue,
    problem: SettingProblem | null = null,
  ): Promise<boolean> => {
    if (problem !== null) {
      setError(settingId, { reason: problem, message: problem });
      return false;
    }
    const previous = values.value[settingId];
    if (sameValue(previous, value)) {
      setError(settingId, null);
      return true;
    }
    const write = (lastWrite.get(settingId) ?? 0) + 1;
    lastWrite.set(settingId, write);
    values.value = { ...values.value, [settingId]: value };
    setSaving(settingId, true);
    try {
      const stored = await engine.extensions.setSettingValue(
        extensionId,
        settingId,
        value,
      );
      if (lastWrite.get(settingId) === write) {
        values.value = stored;
        setError(settingId, null);
      }
      return true;
    } catch (caught) {
      if (lastWrite.get(settingId) === write) {
        values.value = { ...values.value, [settingId]: previous as JsonValue };
        setError(settingId, toSettingError(caught));
      }
      return false;
    } finally {
      if (lastWrite.get(settingId) === write) setSaving(settingId, false);
    }
  };

  /** «Сбросить»: все значения по умолчанию. */
  const reset = async (): Promise<boolean> => {
    if (resetting.value) return false;
    resetting.value = true;
    resetError.value = null;
    try {
      values.value = await engine.extensions.resetSettingValues(extensionId);
      errors.value = {};
      return true;
    } catch (caught) {
      resetError.value = errorText(caught);
      return false;
    } finally {
      resetting.value = false;
    }
  };

  const unsubscribe = engine.subscribe((event) => {
    // слушатель не вызывает команды синхронно (API §7)
    if (
      event.type === 'contributions-changed' ||
      (event.type === 'settings-changed' &&
        event.scope === 'extensionValues' &&
        (event.extensionId === undefined || event.extensionId === extensionId))
    ) {
      queueMicrotask(() => void load());
    }
  });
  onScopeDispose(unsubscribe);

  void load();
  return {
    definitions,
    values,
    state,
    loadError,
    errors,
    saving,
    resetting,
    resetError,
    load,
    set,
    reset,
  };
};
