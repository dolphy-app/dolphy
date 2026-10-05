<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { STATUS_VIEW, legendStatuses } from '../lib/view.ts';
import type { GraphView } from '../lib/view.ts';

const props = defineProps<{
  /** Название курса: видно, пока граф ещё грузится. */
  title: string;
  view: GraphView | null;
}>();

const { t } = useI18n();
const course = computed(() => props.view?.courses[0] ?? null);
const legend = computed(() => (props.view ? legendStatuses(props.view) : []));
</script>

<template>
  <div class="toolbar">
    <slot name="prepend" />

    <div class="course">
      <h2 class="text-title-medium font-weight-bold text-high-emphasis">
        {{ title }}
      </h2>
      <span v-if="course" class="text-label-large text-medium-emphasis">
        {{
          t('graph.frame.mastered', {
            done: course.mastered,
            total: course.lessonIds.length,
          })
        }}
      </span>
    </div>

    <div
      v-if="view"
      class="legend"
      role="group"
      :aria-label="t('graph.legend.title')"
    >
      <ul class="legend-list">
        <li
          v-for="status in legend"
          :key="status"
          class="d-flex align-center ga-1"
          :title="t(`graph.statusHint.${status}`)"
        >
          <v-icon
            :icon="STATUS_VIEW[status].icon"
            :color="STATUS_VIEW[status].color"
            size="16"
          />
          <span class="text-label-large">
            {{ t(`graph.status.${status}`) }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 4px 20px;
  align-items: center;
  min-height: 48px;
  padding: 4px 12px;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.course {
  display: flex;
  gap: 0 12px;
  align-items: baseline;
  min-width: 0;
}

.legend {
  min-width: 0;
}

.legend-list {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
