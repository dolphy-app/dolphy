<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExerciseTaskDto, VerdictDto } from '@dolphy-app/engine-contract';
import { ANSWER_EVENT } from '@dolphy-app/extension-api';
import type { AnswerChangeDetail } from '@dolphy-app/extension-api';
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
const host = ref<HTMLElement | null>(null);
const element = ref<HTMLElement | null>(null);
const loadError = ref(false);
let token = 0;

const frameSrc = computed(() => {
  if (!props.task.isolated) return null;
  try {
    return frameUrlOf(props.task.rendererUrl);
  } catch {
    return null;
  }
});
const failed = computed(
  () => loadError.value || (props.task.isolated && frameSrc.value === null),
);
const frameKey = computed(() => `${props.task.type}:${props.task.element}`);
const frameTitle = computed(() =>
  t('exercisePanel.answer.frameTitle', { label: props.label }),
);

const onFrameError = (message: string) => {
  console.error(
    { message, element: props.task.element },
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
  if (props.task.isolated) return;
  try {
    await ensureAnswerElement(props.task);
  } catch {
    if (current === token) loadError.value = true;
    return;
  }
  if (current !== token || !host.value) return;
  const created = document.createElement(props.task.element);
  created.setAttribute('aria-label', props.label);
  created.addEventListener(ANSWER_EVENT.change, onChange);
  created.addEventListener(ANSWER_EVENT.submit, onSubmit);
  host.value.replaceChildren(created);
  element.value = created;
};

watch(() => [props.task.type, props.task.element, props.task.isolated], mount, {
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
      :text="t('exercisePanel.answer.loadFailed', { element: task.element })"
    />
    <IsolatedFrame
      v-if="task.isolated && frameSrc !== null && !loadError"
      :key="frameKey"
      :src="frameSrc"
      :title="frameTitle"
      :init="{
        mode: 'answer',
        rendererUrl: task.rendererUrl,
        element: task.element,
        label,
      }"
      :disabled="disabled"
      :view="view"
      :verdict="verdict"
      @change="emit('change', $event)"
      @submit="emit('submit')"
      @error="onFrameError"
    />
    <div v-else-if="!task.isolated" ref="host" />
  </div>
</template>
