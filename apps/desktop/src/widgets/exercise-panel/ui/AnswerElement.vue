<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExerciseTaskDto, VerdictDto } from '@dolphy-app/engine-contract';
import { ANSWER_EVENT } from '@dolphy-app/extension-api';
import type { AnswerChangeDetail } from '@dolphy-app/extension-api';
import { useContributions } from '@/shared/api/engine/contributions.ts';
import { frameUrlOf } from '@/shared/lib/frame-bridge.ts';
import { ensureAnswerElement } from '@/shared/lib/answer-element.ts';
import IsolatedFrame from '@/shared/ui/IsolatedFrame.vue';

const props = defineProps<{
  task: ExerciseTaskDto;
  view: unknown;
  disabled: boolean;
  verdict: VerdictDto | null;
  label: string;
}>();
const emit = defineEmits<{
  change: [detail: AnswerChangeDetail];
  submit: [];
}>();

const { t } = useI18n();
const contributions = useContributions();
const host = ref<HTMLElement | null>(null);
const element = ref<HTMLElement | null>(null);
const loadError = ref(false);
let token = 0;

/**
 * Вид задания, по которому рисуется ввод. Смонтированный элемент расширения
 * не трогаем, что бы ни случилось с расширением (R3): берётся вид из задания.
 * Исключение — происхождение `dev`: правка файлов даёт новую ревизию, элемент
 * пересоздаётся по действующему виду из вкладов (R5).
 */
const liveTask = computed<ExerciseTaskDto>(() => {
  if (props.task.origin !== 'dev') return props.task;
  const current = contributions.value.exerciseTypes.find(
    ({ type }) => type === props.task.type,
  );
  if (current === undefined) return props.task;
  const { element, rendererUrl, isolated, revision } = current;
  return { ...props.task, element, rendererUrl, isolated, revision };
});
const instanceKey = computed(
  () =>
    `${liveTask.value.type}:${liveTask.value.element}:${
      liveTask.value.origin === 'dev' ? liveTask.value.revision : ''
    }`,
);

const frameSrc = computed(() => {
  if (!liveTask.value.isolated) return null;
  try {
    return frameUrlOf(liveTask.value.rendererUrl);
  } catch {
    return null;
  }
});
const failed = computed(
  () => loadError.value || (liveTask.value.isolated && frameSrc.value === null),
);
const frameTitle = computed(() =>
  t('exercisePanel.answer.frameTitle', { label: props.label }),
);

const onFrameError = (message: string) => {
  console.error(
    { message, element: liveTask.value.element },
    'answer frame failed',
  );
  loadError.value = true;
};

const onChange = (event: Event) => {
  emit('change', (event as CustomEvent<AnswerChangeDetail>).detail);
};
const onSubmit = () => emit('submit');

const detach = () => {
  element.value?.removeEventListener(ANSWER_EVENT.change, onChange);
  element.value?.removeEventListener(ANSWER_EVENT.submit, onSubmit);
  element.value?.remove();
  element.value = null;
};

const mount = async () => {
  const current = ++token;
  detach();
  loadError.value = false;
  if (liveTask.value.isolated) return;
  try {
    await ensureAnswerElement(liveTask.value);
  } catch {
    if (current === token) loadError.value = true;
    return;
  }
  if (current !== token || !host.value) return;
  const created = document.createElement(liveTask.value.element);
  created.setAttribute('aria-label', props.label);
  created.addEventListener(ANSWER_EVENT.change, onChange);
  created.addEventListener(ANSWER_EVENT.submit, onSubmit);
  host.value.replaceChildren(created);
  element.value = created;
};

watch(() => [instanceKey.value, liveTask.value.isolated], mount, {
  immediate: true,
  flush: 'post',
});
watchEffect(() => {
  const el = element.value;
  if (!el) return;
  // свойства DOM, а не атрибуты: view и verdict — произвольные объекты
  Object.assign(el, {
    view: props.view,
    disabled: props.disabled,
    verdict: props.verdict,
  });
});
onBeforeUnmount(() => {
  token += 1;
  detach();
});
</script>

<template>
  <div>
    <v-alert
      v-if="failed"
      type="error"
      variant="tonal"
      :text="
        t('exercisePanel.answer.loadFailed', { element: liveTask.element })
      "
    />
    <IsolatedFrame
      v-if="liveTask.isolated && frameSrc !== null && !loadError"
      :key="instanceKey"
      :src="frameSrc"
      :title="frameTitle"
      :init="{
        mode: 'answer',
        rendererUrl: liveTask.rendererUrl,
        element: liveTask.element,
        label,
      }"
      :disabled="disabled"
      :view="view"
      :verdict="verdict"
      @change="emit('change', $event)"
      @submit="emit('submit')"
      @error="onFrameError"
    />
    <div v-else-if="!liveTask.isolated" ref="host" />
  </div>
</template>
