<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ExtensionSettingDefDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import { parseNumberInput } from '../model/extension-settings.ts';
import type {
  SettingError,
  SettingProblem,
} from '../model/extension-settings.ts';

const props = defineProps<{
  definition: ExtensionSettingDefDto;
  /** Действующее значение (в том числе ещё не подтверждённое движком). */
  value: JsonValue | undefined;
  error: SettingError | null;
}>();

const emit = defineEmits<{
  /** Введено значение; `problem` — ввод не разобран, запись не нужна. */
  commit: [value: JsonValue, problem: SettingProblem | null];
}>();

const { t, n } = useI18n();

// строка и число правятся черновиком и записываются по уходу из поля или Enter
const draft = ref('');
const editing = ref(false);

watch(
  () => [props.value, props.error] as const,
  ([value, error]) => {
    // пока человек печатает или значение отклонено, его ввод не затирается
    if (editing.value || error !== null) return;
    draft.value = value === undefined ? '' : String(value);
  },
  { immediate: true },
);

const commitDraft = () => {
  editing.value = false;
  if (props.definition.type === 'string') {
    emit('commit', draft.value, null);
  } else if (props.definition.type === 'number') {
    const parsed = parseNumberInput(draft.value);
    emit('commit', parsed ?? 0, parsed === null ? 'not-a-number' : null);
  }
};

// Enter завершает ввод так же, как уход из поля: значение записывается один раз
const blurTarget = (event: Event) => {
  if (event.target instanceof HTMLElement) event.target.blur();
};

const errorMessages = computed(() => {
  const { error } = props;
  if (error === null) return [];
  return [
    error.reason === null
      ? error.message
      : t(`settings.extensions.settingsDialog.problems.${error.reason}`),
  ];
});

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

const hint = computed(() => {
  const { definition } = props;
  const parts = definition.description === null ? [] : [definition.description];
  if (definition.type === 'number') {
    const range = rangeHint(definition.min, definition.max);
    if (range !== null) parts.push(range);
  }
  return parts.join(' ');
});
</script>

<template>
  <v-switch
    v-if="definition.type === 'boolean'"
    :model-value="value === true"
    :label="definition.label"
    :hint="hint"
    :persistent-hint="hint !== ''"
    :error-messages="errorMessages"
    color="primary"
    density="compact"
    inset
    :data-testid="`setting-${definition.id}`"
    @update:model-value="emit('commit', $event === true, null)"
  />
  <v-text-field
    v-else-if="definition.type === 'string'"
    v-model="draft"
    :label="definition.label"
    :hint="hint"
    :persistent-hint="hint !== ''"
    :error-messages="errorMessages"
    :counter="definition.maxLength ?? undefined"
    variant="outlined"
    density="comfortable"
    :data-testid="`setting-${definition.id}`"
    @focus="editing = true"
    @blur="commitDraft"
    @keydown.enter="blurTarget"
  />
  <v-text-field
    v-else-if="definition.type === 'number'"
    v-model="draft"
    type="number"
    :label="definition.label"
    :hint="hint"
    :persistent-hint="hint !== ''"
    :error-messages="errorMessages"
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
    :items="definition.options"
    item-title="label"
    item-value="value"
    :label="definition.label"
    :hint="hint"
    :persistent-hint="hint !== ''"
    :error-messages="errorMessages"
    variant="outlined"
    density="comfortable"
    :data-testid="`setting-${definition.id}`"
    @update:model-value="emit('commit', $event as string, null)"
  />
</template>
