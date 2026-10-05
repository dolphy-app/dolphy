<script setup lang="ts">
import type { Box } from '../lib/placement.ts';

defineProps<{
  /** Подсвеченная область (цель с отступом) в координатах окна; `null` — только затемнение. */
  box: Box | null;
}>();
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
