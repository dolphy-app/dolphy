<script setup lang="ts">
import { computed, onErrorCaptured, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExerciseTaskDto, VerdictDto } from '@dolphy-app/engine-contract';
import { isMountable } from '@dolphy-app/extension-api';
import type { AnswerChange } from '@dolphy-app/extension-api';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';
import type { ClientAnswerView } from '@/shared/lib/extension-clients.ts';
import ExtensionScope from '@/shared/ui/ExtensionScope.vue';
import MountableHost from '@/shared/ui/MountableHost.vue';
import { answerViewOf } from '../model/answer-view.ts';

const props = withDefaults(
  defineProps<{
    task: ExerciseTaskDto;
    view: unknown;
    /** Текущий ответ (для восстановления); `undefined` — ответа ещё нет. */
    value?: unknown;
    disabled: boolean;
    verdict: VerdictDto | null;
    label: string;
  }>(),
  { value: undefined },
);
const emit = defineEmits<{
  change: [detail: AnswerChange];
  submit: [];
}>();

const { t } = useI18n();
const clients = useExtensionClients();

/**
 * Вид задания, по которому рисуется ввод: из реестра окна. Обновление или
 * правка расширения (режим разработчика) подменяют компонент без перезагрузки
 * окна (введённый ответ приходит из `value`). Расширение удалено или
 * отключено посреди упражнения — остаётся последний найденный вид; если вида не
 * было вовсе, показывается причина с повтором загрузки.
 */
const current = shallowRef<ClientAnswerView | null>(null);
watch(
  () =>
    answerViewOf(
      clients.answerViews.value,
      props.task.type,
      props.task.extensionId,
    ),
  (found) => {
    if (found !== null) current.value = found;
  },
  { immediate: true, flush: 'sync' },
);
const ownerState = computed(() =>
  clients.states.value.get(props.task.extensionId),
);

const failure = ref<string | null>(null);
// повтор после сбоя рендера создаёт компонент заново
const attempt = ref(0);

const retry = () => {
  if (failure.value !== null) {
    failure.value = null;
    attempt.value += 1;
    return;
  }
  clients.reload(props.task.extensionId);
};

const showFailure = (error: unknown) => {
  failure.value = error instanceof Error ? error.message : String(error);
};

onErrorCaptured((error) => {
  console.error({ error, type: props.task.type }, 'answer view failed');
  showFailure(error);
  return false;
});

const mountable = computed(() =>
  current.value !== null && isMountable(current.value.component)
    ? current.value.component
    : null,
);
const vueComponent = computed(() =>
  current.value === null || isMountable(current.value.component)
    ? null
    : current.value.component,
);
const mountProps = computed(() => ({
  view: props.view,
  value: props.value,
  disabled: props.disabled,
  verdict: props.verdict,
  label: props.label,
}));

const message = computed(
  () =>
    failure.value ??
    ownerState.value?.error ??
    `no answer view registered for '${props.task.type}'`,
);
</script>

<template>
  <div>
    <v-alert
      v-if="
        failure !== null ||
        (current === null && ownerState?.status !== 'loading')
      "
      type="error"
      variant="tonal"
      density="compact"
      data-testid="answer-view-failed"
    >
      {{ t('exercisePanel.answer.loadFailed', { type: task.type }) }}
      <div class="caption">{{ message }}</div>
      <template #append>
        <v-btn
          size="small"
          variant="text"
          data-testid="answer-view-retry"
          @click="retry"
        >
          {{ t('exercisePanel.answer.retry') }}
        </v-btn>
      </template>
    </v-alert>
    <MountableHost
      v-else-if="current !== null && mountable !== null"
      :key="`${current.key}:${attempt}`"
      :extension-id="current.extensionId"
      :mountable="mountable"
      :props="mountProps"
      @change="emit('change', $event)"
      @submit="emit('submit')"
      @error="showFailure"
    />
    <ExtensionScope
      v-else-if="current !== null && vueComponent !== null"
      :key="`${current.key}:${attempt}`"
      :extension-id="current.extensionId"
    >
      <component
        :is="vueComponent"
        :view="view"
        :value="value"
        :disabled="disabled"
        :verdict="verdict"
        :label="label"
        @change="emit('change', $event)"
        @submit="emit('submit')"
      />
    </ExtensionScope>
  </div>
</template>

<style scoped>
.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
