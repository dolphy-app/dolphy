<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { MATERIAL_WIDTH_RANGE } from '@dolphy-app/engine-contract';
import { clampWidth, maxWidth, widthFromKey } from '../lib/material-layout.ts';

const emit = defineEmits<{
  /** Живая ширина панели, px (при перетаскивании и с клавиатуры). */
  resize: [width: number];
  /** Выбор закончен: можно сохранять. */
  commit: [];
  /** Клавиатура: сохранить после паузы. */
  commitSoon: [];
  /** Вернуть ширину по умолчанию. */
  reset: [];
}>();

const { t } = useI18n();
const root = useTemplateRef<HTMLElement>('root');
const dragging = ref(false);
const current = ref<number>(MATERIAL_WIDTH_RANGE.min);
const limit = ref<number>(MATERIAL_WIDTH_RANGE.max);

const panel = () => root.value?.previousElementSibling as HTMLElement | null;
const available = () => root.value?.parentElement?.clientWidth ?? 0;

const measure = () => {
  current.value = Math.round(panel()?.getBoundingClientRect().width ?? 0);
  limit.value = maxWidth(available());
};

// ширину панели меняет и CSS (умолчание, окно), поэтому значение берётся из DOM
const observer: { current: ResizeObserver | null } = { current: null };
onMounted(() => {
  measure();
  const target = panel();
  if (target === null) return;
  observer.current = new ResizeObserver(measure);
  observer.current.observe(target);
  if (root.value?.parentElement) {
    observer.current.observe(root.value.parentElement);
  }
});

const drag: { startX: number; startWidth: number; frame: number | null } = {
  startX: 0,
  startWidth: 0,
  frame: null,
};

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return;
  const target = panel();
  if (target === null) return;
  event.preventDefault();
  root.value?.setPointerCapture(event.pointerId);
  drag.startX = event.clientX;
  drag.startWidth = target.getBoundingClientRect().width;
  dragging.value = true;
  document.body.style.userSelect = 'none';
};

const onPointerMove = (event: PointerEvent) => {
  if (!dragging.value) return;
  const { clientX } = event;
  if (drag.frame !== null) cancelAnimationFrame(drag.frame);
  drag.frame = requestAnimationFrame(() => {
    drag.frame = null;
    emit(
      'resize',
      clampWidth(drag.startWidth + clientX - drag.startX, available()),
    );
  });
};

const stop = () => {
  if (!dragging.value) return;
  dragging.value = false;
  document.body.style.userSelect = '';
  if (drag.frame !== null) cancelAnimationFrame(drag.frame);
  drag.frame = null;
  emit('commit');
};

const onKeyDown = (event: KeyboardEvent) => {
  const next = widthFromKey(
    event.key,
    event.shiftKey,
    current.value,
    available(),
  );
  if (next === null) return;
  event.preventDefault();
  // следующее нажатие считает от этого значения, не дожидаясь ResizeObserver
  current.value = next;
  emit('resize', next);
  emit('commitSoon');
};

onBeforeUnmount(() => {
  observer.current?.disconnect();
  if (drag.frame !== null) cancelAnimationFrame(drag.frame);
  document.body.style.userSelect = '';
});
</script>

<template>
  <div
    ref="root"
    class="splitter"
    :class="{ dragging }"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('exercisePanel.splitter.label')"
    :aria-valuemin="MATERIAL_WIDTH_RANGE.min"
    :aria-valuemax="limit"
    :aria-valuenow="current"
    :title="t('exercisePanel.splitter.hint')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="stop"
    @pointercancel="stop"
    @lostpointercapture="stop"
    @keydown="onKeyDown"
    @dblclick="emit('reset')"
  />
</template>

<style scoped>
/* нулевая ширина: граница не сдвигает вёрстку, а зона захвата шире линии */
.splitter {
  position: relative;
  z-index: 2;
  flex: 0 0 0;
  touch-action: none;
  outline: none;
}

.splitter::before {
  content: '';
  position: absolute;
  inset: 0 -5px;
  cursor: col-resize;
}

.splitter::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 -1px;
  width: 2px;
  background: transparent;
  pointer-events: none;
}

.splitter:hover::after,
.splitter:focus-visible::after,
.splitter.dragging::after {
  background: rgb(var(--v-theme-primary));
}

@media (prefers-reduced-motion: no-preference) {
  .splitter::after {
    transition: background-color 120ms ease-out;
  }
}
</style>
