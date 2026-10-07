<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ExtensionSettingDefDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import SettingListEditor from './SettingListEditor.vue';
import { settingTextOf } from '../model/extension-settings-form.ts';
import { parseNumberInput } from '../model/extension-settings.ts';
import type {
  SettingError,
  SettingProblem,
} from '../model/extension-settings.ts';

const props = defineProps({
  definition: {
    type: Object as PropType<ExtensionSettingDefDto>,
    required: true,
  },
  /**
   * Действующее значение (в том числе ещё не подтверждённое движком).
   * `type: null` — без приведения типов: у объявления с `boolean` Vue
   * превращает пустую строку в `true`.
   */
  value: {
    type: null as unknown as PropType<JsonValue | undefined>,
    default: undefined,
  },
  error: {
    type: Object as PropType<SettingError | null>,
    default: null,
  },
});

const emit = defineEmits<{
  /** Введено значение; `problem` — ввод не разобран, запись не нужна. */
  commit: [value: JsonValue, problem: SettingProblem | null];
}>();

const { t, n } = useI18n();
const extensionText = useExtensionText();

// строка и число правятся черновиком и записываются по уходу из поля или Enter
const draft = ref('');
const editing = ref(false);

watch(
  () => [props.value, props.error] as const,
  ([value, error]) => {
    // пока человек печатает или значение отклонено, его ввод не затирается
    if (editing.value || error !== null) return;
    draft.value =
      value === undefined || Array.isArray(value) ? '' : String(value);
  },
  { immediate: true },
);

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const commitDraft = () => {
  editing.value = false;
  if (props.definition.type === 'string' || props.definition.type === 'text') {
    emit('commit', draft.value, null);
  } else if (props.definition.type === 'color') {
    const text = draft.value.trim();
    const valid = COLOR_PATTERN.test(text);
    emit('commit', valid ? text.toLowerCase() : text, valid ? null : 'format');
  } else if (props.definition.type === 'number') {
    const parsed = parseNumberInput(draft.value);
    emit('commit', parsed ?? 0, parsed === null ? 'not-a-number' : null);
  }
};

/** Значение для `<input type="color">`: он принимает только `#rrggbb`. */
const pickerValue = computed(() =>
  typeof props.value === 'string' && COLOR_PATTERN.test(props.value)
    ? props.value.toLowerCase()
    : '#000000',
);

const pick = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  draft.value = event.target.value;
  commitDraft();
};

// Enter завершает ввод так же, как уход из поля: значение записывается один раз
const blurTarget = (event: Event) => {
  if (event.target instanceof HTMLElement) event.target.blur();
};

/** Подсказка о границах числа: «От 1 до 10», «Не меньше 1» или «Не больше 10». */
const rangeHint = (min: number | null, max: number | null): string | null => {
  const prefix = 'settings.extensions.settingsDialog';
  if (min !== null && max !== null) {
    return t(`${prefix}.hintRange`, { min: n(min), max: n(max) });
  }
  if (min !== null) return t(`${prefix}.hintMin`, { min: n(min) });
  if (max !== null) return t(`${prefix}.hintMax`, { max: n(max) });
  return null;
};

const range = computed(() =>
  props.definition.type === 'number'
    ? rangeHint(props.definition.min, props.definition.max)
    : null,
);

const text = computed(() => settingTextOf(props.definition, extensionText.of));
const label = computed(() => text.value.label);
const options = computed(() => text.value.options);

const hint = computed(() =>
  [text.value.description, range.value]
    .filter((part): part is string => part !== null)
    .join(' '),
);

// отказ по границам заменяет подсказку, поэтому границы повторяются в тексте ошибки
const errorMessages = computed(() => {
  const { error } = props;
  if (error === null) return [];
  if (error.reason === null) return [error.message];
  const problem = t(
    `settings.extensions.settingsDialog.problems.${error.reason}`,
  );
  return [
    error.reason === 'range' && range.value !== null
      ? `${problem} ${range.value}.`
      : problem,
  ];
});
</script>

<template>
  <div class="setting-field mb-4">
    <v-switch
      v-if="definition.type === 'boolean'"
      :model-value="value === true"
      :label="label"
      :hint="hint"
      :persistent-hint="hint !== ''"
      :error-messages="errorMessages"
      hide-details="auto"
      color="primary"
      density="compact"
      inset
      :data-testid="`setting-${definition.id}`"
      @update:model-value="emit('commit', $event === true, null)"
    />
    <v-text-field
      v-else-if="definition.type === 'string'"
      v-model="draft"
      :label="label"
      :hint="hint"
      :persistent-hint="hint !== ''"
      :error-messages="errorMessages"
      hide-details="auto"
      :counter="definition.maxLength ?? undefined"
      variant="outlined"
      density="comfortable"
      :data-testid="`setting-${definition.id}`"
      @focus="editing = true"
      @blur="commitDraft"
      @keydown.enter="blurTarget"
    />
    <v-textarea
      v-else-if="definition.type === 'text'"
      v-model="draft"
      :label="label"
      :hint="hint"
      :persistent-hint="hint !== ''"
      :error-messages="errorMessages"
      hide-details="auto"
      :counter="definition.maxLength ?? undefined"
      rows="3"
      auto-grow
      variant="outlined"
      density="comfortable"
      :data-testid="`setting-${definition.id}`"
      @focus="editing = true"
      @blur="commitDraft"
    />
    <div
      v-else-if="definition.type === 'color'"
      class="d-flex ga-3 align-start"
    >
      <input
        type="color"
        class="color-picker"
        :value="pickerValue"
        :aria-label="
          t('settings.extensions.settingsDialog.color.picker', {
            label,
          })
        "
        :data-testid="`setting-${definition.id}-picker`"
        @change="pick"
      />
      <v-text-field
        v-model="draft"
        :label="label"
        :hint="hint"
        :persistent-hint="hint !== ''"
        :error-messages="errorMessages"
        hide-details="auto"
        maxlength="7"
        variant="outlined"
        density="comfortable"
        :data-testid="`setting-${definition.id}`"
        @focus="editing = true"
        @blur="commitDraft"
        @keydown.enter="blurTarget"
      />
    </div>
    <SettingListEditor
      v-else-if="definition.type === 'list'"
      :label="label"
      :items="Array.isArray(value) ? (value as string[]) : []"
      :max-items="definition.maxItems"
      :item-max-length="definition.itemMaxLength"
      :hint="hint"
      :messages="errorMessages"
      :test-id="`setting-${definition.id}`"
      @change="emit('commit', $event, null)"
    />
    <v-text-field
      v-else-if="definition.type === 'number'"
      v-model="draft"
      type="number"
      :label="label"
      :hint="hint"
      :persistent-hint="hint !== ''"
      :error-messages="errorMessages"
      hide-details="auto"
      :min="definition.min ?? undefined"
      :max="definition.max ?? undefined"
      :step="definition.integer ? 1 : 'any'"
      variant="outlined"
      density="comfortable"
      :data-testid="`setting-${definition.id}`"
      @focus="editing = true"
      @blur="commitDraft"
      @keydown.enter="blurTarget"
    />
    <v-select
      v-else
      :model-value="value"
      :items="options"
      item-title="title"
      item-value="value"
      :label="label"
      :hint="hint"
      :persistent-hint="hint !== ''"
      :error-messages="errorMessages"
      hide-details="auto"
      variant="outlined"
      density="comfortable"
      :data-testid="`setting-${definition.id}`"
      @update:model-value="emit('commit', $event as string, null)"
    />
    <!-- ошибка появляется, когда фокус уже ушёл из поля: сообщение под полем читалка сама не объявит -->
    <span class="visually-hidden" role="status" aria-live="polite">{{
      errorMessages.join(' ')
    }}</span>
  </div>
</template>

<style scoped>
.color-picker {
  inline-size: 48px;
  block-size: 48px;
  padding: 0;
  border: 1px solid rgb(var(--v-theme-on-surface), var(--v-border-opacity));
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
