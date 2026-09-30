<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Handle, Position } from '@vue-flow/core';
import type { NodeProps } from '@vue-flow/core';
import type { LessonNodeData } from '../lib/flow.ts';
import type { Direction } from '../lib/flow.ts';
import { HANDLE } from '../lib/flow.ts';
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/layout.ts';
import { STATUS_VIEW } from '../lib/view.ts';
import { useGraphContext } from '../model/context.ts';

const SCORE_MAX = 5;
const PERCENT = 100;
const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const props = defineProps<NodeProps<LessonNodeData>>();

const { t, n } = useI18n();
const graph = useGraphContext();

const lesson = computed(() => graph.view.value?.lessons.get(props.id) ?? null);
const status = computed(() => lesson.value?.status ?? 'ready');
const look = computed(() => STATUS_VIEW[status.value]);
const selected = computed(() => graph.selectedId.value === props.id);
const percent = computed(() =>
  Math.round(((lesson.value?.score ?? 0) / SCORE_MAX) * PERCENT),
);
const scoreText = computed(() => {
  const score = lesson.value?.score ?? null;
  return score === null
    ? t('graph.node.noScore')
    : t('graph.node.score', {
        score: n(score, { maximumFractionDigits: 1 }),
      });
});
const dueText = computed(() =>
  t('graph.node.due', { n: lesson.value?.due ?? 0 }, lesson.value?.due ?? 0),
);
const label = computed(() =>
  t('graph.node.aria', {
    name: lesson.value?.name ?? '',
    status: t(`graph.status.${status.value}`),
    score: scoreText.value,
    due: dueText.value,
  }),
);

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    graph.select(props.id);
    return;
  }
  const direction = ARROWS[event.key];
  if (direction) {
    event.preventDefault();
    graph.move(props.id, direction);
  }
};
</script>

<template>
  <div
    v-if="lesson"
    class="lesson-node nopan"
    :class="[`status-${status}`, { selected }]"
    :style="{ width: `${NODE_WIDTH}px`, height: `${NODE_HEIGHT}px` }"
    role="button"
    :tabindex="graph.tabStopId.value === id ? 0 : -1"
    :aria-label="label"
    :aria-pressed="selected"
    :data-lesson="id"
    @click="graph.select(id)"
    @keydown="onKeydown"
  >
    <Handle
      :id="HANDLE.dependencyIn"
      type="target"
      :position="Position.Left"
      :connectable="false"
    />
    <Handle
      :id="HANDLE.dependencyOut"
      type="source"
      :position="Position.Right"
      :connectable="false"
    />
    <Handle
      :id="HANDLE.coverIn"
      type="target"
      :position="Position.Top"
      :connectable="false"
    />
    <Handle
      :id="HANDLE.coverOut"
      type="source"
      :position="Position.Bottom"
      :connectable="false"
    />

    <div class="d-flex align-start ga-2">
      <v-icon :icon="look.icon" :color="look.color" size="20" class="mt-05" />
      <span class="name text-title-small font-weight-bold">
        {{ lesson.name }}
      </span>
    </div>
    <div class="meta text-label-medium text-medium-emphasis">
      <span class="status-text">{{ t(`graph.status.${status}`) }}</span>
      <span v-if="lesson.due > 0" class="due">
        <v-icon icon="mdi-refresh" size="14" />
        {{ dueText }}
      </span>
    </div>
    <v-progress-linear
      class="score"
      :model-value="percent"
      :color="look.color"
      height="4"
      rounded
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.lesson-node {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 12px;
  overflow: hidden;
  cursor: pointer;
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  outline: none;
}

/* закрытый урок — пунктирная рамка: статус читается и без цвета */
.status-locked,
.status-blacklisted,
.status-superseded {
  border-style: dashed;
}

.lesson-node:hover {
  background: rgb(var(--v-theme-surface-variant));
}

.lesson-node:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.selected {
  border: 2px solid rgb(var(--v-theme-primary));
  padding: 9px 11px;
}

.name {
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.25;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.due {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.mt-05 {
  margin-top: 2px;
}

/* ручки нужны только для рёбер: не показываем и не ловим мышь */
:deep(.vue-flow__handle) {
  width: 1px;
  height: 1px;
  min-width: 0;
  min-height: 0;
  background: transparent;
  border: none;
  pointer-events: none;
}
</style>
