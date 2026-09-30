<script setup lang="ts">
import { onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExerciseTaskDto, VerdictDto } from '@lms/engine-contract';
import { ANSWER_EVENT } from '@lms/extension-api';
import type { AnswerChangeDetail } from '@lms/extension-api';
import { ensureAnswerElement } from '../api/answer-element.ts';

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

watch(() => [props.task.type, props.task.element], mount, {
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
      v-if="loadError"
      type="error"
      variant="tonal"
      :text="t('session.answer.loadFailed', { element: task.element })"
    />
    <div ref="host" />
  </div>
</template>
