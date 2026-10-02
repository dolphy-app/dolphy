<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core';
import type { CourseNodeData } from '../lib/flow.ts';

// название курса и счётчик — в панели над полотном (GraphCanvas): шапка внутри
// рамки уходила из кадра при панорамировании длинного курса
defineProps<NodeProps<CourseNodeData>>();
</script>

<template>
  <div class="course-frame" />
</template>

<style scoped>
.course-frame {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: rgba(var(--v-theme-surface-variant), 0.45);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
}
</style>
