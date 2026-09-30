<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { NodeProps } from '@vue-flow/core';
import type { CourseNodeData } from '../lib/flow.ts';
import { FRAME_HEADER } from '../lib/layout.ts';
import { useGraphContext } from '../model/context.ts';

const props = defineProps<NodeProps<CourseNodeData>>();

const { t } = useI18n();
const graph = useGraphContext();

const course = computed(
  () => graph.view.value?.courses.find(({ id }) => id === props.id) ?? null,
);
</script>

<template>
  <div v-if="course" class="course-frame">
    <header class="header" :style="{ height: `${FRAME_HEADER}px` }">
      <h2 class="text-title-medium font-weight-bold">{{ course.name }}</h2>
      <span class="text-label-large text-medium-emphasis">
        {{
          t('graph.frame.mastered', {
            done: course.mastered,
            total: course.lessonIds.length,
          })
        }}
      </span>
    </header>
  </div>
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

.header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 24px;
}
</style>
