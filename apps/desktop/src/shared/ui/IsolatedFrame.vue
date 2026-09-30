<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import type { AnswerChangeDetail } from '@dolphy-app/extension-api';
import { createFrameHost } from '@/shared/lib/frame-bridge.ts';
import type { FrameHost, FrameInit } from '@/shared/lib/frame-bridge.ts';

const MIN_HEIGHT_PX = 40;

const props = defineProps<{
  /** Страница рамки: `dolphy-ext://<id>/__dolphy/frame.html`. */
  src: string;
  title: string;
  init: FrameInit;
  disabled?: boolean;
  view?: unknown;
  value?: unknown;
  verdict?: unknown;
}>();
const emit = defineEmits<{
  change: [detail: AnswerChangeDetail];
  submit: [];
  done: [];
  error: [message: string];
}>();

const frame = useTemplateRef<HTMLIFrameElement>('frame');
const reported = ref(0);
// пока рамка не сообщила высоту, держим минимум: разметка не прыгает
const height = computed(() => Math.max(reported.value, MIN_HEIGHT_PX));
const holder: { host: FrameHost | null } = { host: null };

onMounted(() => {
  if (frame.value === null) return;
  holder.host = createFrameHost({
    frame: frame.value,
    init: props.init,
    props: {
      view: props.view,
      value: props.value,
      disabled: props.disabled ?? false,
      verdict: props.verdict ?? null,
    },
    handlers: {
      onChange: (detail) => emit('change', detail),
      onSubmit: () => emit('submit'),
      onSize: (next) => {
        reported.value = next;
      },
      onDone: () => emit('done'),
      onError: (message) => emit('error', message),
    },
  });
});

watch(
  () => ({
    view: props.view,
    value: props.value,
    disabled: props.disabled ?? false,
    verdict: props.verdict ?? null,
  }),
  (next) => holder.host?.update(next),
  { deep: true },
);

onBeforeUnmount(() => holder.host?.dispose());
</script>

<template>
  <iframe
    ref="frame"
    class="isolated-frame"
    sandbox="allow-scripts"
    :src="src"
    :title="title"
    :data-mode="init.mode"
    :style="{ height: `${height}px` }"
  />
</template>

<style scoped>
.isolated-frame {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
}
</style>
