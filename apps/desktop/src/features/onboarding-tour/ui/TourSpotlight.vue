<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  /** Цель шага; `null` — только затемнение. */
  element: HTMLElement | null;
  /** Отступ подсветки от границ цели, px. */
  padding?: number;
}>();

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const box = ref<Box | null>(null);
const frame = { id: 0 };

// цель не мутируется: подсветка — отдельный блок, который следует за ней
// каждый кадр (прокрутка вложенных контейнеров и размер окна дают то же самое)
const track = () => {
  const gap = props.padding ?? 6;
  if (props.element?.isConnected) {
    const rect = props.element.getBoundingClientRect();
    const next = {
      left: Math.round(rect.left - gap),
      top: Math.round(rect.top - gap),
      width: Math.round(rect.width + gap * 2),
      height: Math.round(rect.height + gap * 2),
    };
    const prev = box.value;
    if (
      !prev ||
      prev.left !== next.left ||
      prev.top !== next.top ||
      prev.width !== next.width ||
      prev.height !== next.height
    ) {
      box.value = next;
    }
  } else {
    box.value = null;
  }
  frame.id = requestAnimationFrame(track);
};

onMounted(track);
onBeforeUnmount(() => cancelAnimationFrame(frame.id));
watch(
  () => props.element,
  () => {
    if (!props.element) box.value = null;
  },
);
</script>

<template>
  <!-- затемнение перехватывает клики: посреди шага нельзя открыть диалог или уйти со страницы -->
  <div class="tour-blocker" :class="{ 'tour-dim': !box }" aria-hidden="true" />
  <div
    v-if="box"
    class="tour-hole"
    aria-hidden="true"
    :style="{
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    }"
  />
</template>

<style scoped>
.tour-blocker {
  position: fixed;
  inset: 0;
  z-index: 1999;
}

.tour-dim {
  background: rgb(0 0 0 / 0.5);
}

.tour-hole {
  position: fixed;
  z-index: 1999;
  border-radius: 12px;
  pointer-events: none;
  box-shadow:
    0 0 0 2px rgb(var(--v-theme-primary)),
    0 0 0 100vmax rgb(0 0 0 / 0.5);
  transition:
    left 0.2s,
    top 0.2s,
    width 0.2s,
    height 0.2s;
}

@media (prefers-reduced-motion: reduce) {
  .tour-hole {
    transition: none;
  }
}
</style>
