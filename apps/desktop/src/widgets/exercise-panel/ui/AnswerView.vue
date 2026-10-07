<script setup lang="ts">
import { computed, onErrorCaptured, ref, shallowRef, watch } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExerciseTaskDto, VerdictDto } from '@dolphy-app/engine-contract';
import type { AnswerChange } from '@dolphy-app/extension-api';
import { useContributions } from '@/shared/api/engine/contributions.ts';
import {
  importExtensionModule,
  loadExtensionComponent,
} from '@/shared/lib/extension-component.ts';
import type { LoadExtensionModule } from '@/shared/lib/extension-component.ts';

const props = withDefaults(
  defineProps<{
    task: ExerciseTaskDto;
    view: unknown;
    /** Текущий ответ (для восстановления); `undefined` — ответа ещё нет. */
    value?: unknown;
    disabled: boolean;
    verdict: VerdictDto | null;
    label: string;
    loadModule?: LoadExtensionModule;
  }>(),
  { value: undefined, loadModule: importExtensionModule },
);
const emit = defineEmits<{
  change: [detail: AnswerChange];
  submit: [];
}>();

const { t } = useI18n();
const contributions = useContributions();

/**
 * Вид задания, по которому рисуется ввод. Пока расширение есть во вкладах,
 * ввод рисуется по его действующей ревизии: обновление или правка файлов
 * (режим разработчика) пересоздаёт компонент без перезагрузки окна
 * (введённый ответ приходит из `value`). Расширение удалено или отключено
 * посреди упражнения — остаётся вид из задания.
 */
const liveTask = computed<ExerciseTaskDto>(() => {
  const current = contributions.value.exerciseTypes.find(
    ({ type }) => type === props.task.type,
  );
  if (current === undefined) return props.task;
  const { rendererUrl, revision } = current;
  return { ...props.task, rendererUrl, revision };
});
const instanceKey = computed(
  () => `${liveTask.value.type}:${liveTask.value.revision}`,
);

const component = shallowRef<Component | null>(null);
const failure = ref<string | null>(null);
let token = 0;

const load = async () => {
  const current = ++token;
  failure.value = null;
  component.value = null;
  try {
    const loaded = await loadExtensionComponent(
      liveTask.value,
      'views',
      liveTask.value.type,
      props.loadModule,
    );
    if (current === token) component.value = loaded;
  } catch (error) {
    if (current !== token) return;
    console.error({ error, type: liveTask.value.type }, 'answer view failed');
    failure.value = error instanceof Error ? error.message : String(error);
  }
};
watch(instanceKey, load, { immediate: true });

onErrorCaptured((error) => {
  console.error({ error, type: liveTask.value.type }, 'answer view failed');
  failure.value = error instanceof Error ? error.message : String(error);
  component.value = null;
  return false;
});
</script>

<template>
  <div>
    <v-alert
      v-if="failure !== null"
      type="error"
      variant="tonal"
      density="compact"
      data-testid="answer-view-failed"
    >
      {{ t('exercisePanel.answer.loadFailed', { type: liveTask.type }) }}
      <div class="caption">{{ failure }}</div>
      <template #append>
        <v-btn
          size="small"
          variant="text"
          data-testid="answer-view-retry"
          @click="load"
        >
          {{ t('exercisePanel.answer.retry') }}
        </v-btn>
      </template>
    </v-alert>
    <component
      :is="component"
      v-else-if="component !== null"
      :key="instanceKey"
      :view="view"
      :value="value"
      :disabled="disabled"
      :verdict="verdict"
      :label="label"
      @change="emit('change', $event)"
      @submit="emit('submit')"
    />
  </div>
</template>

<style scoped>
.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
