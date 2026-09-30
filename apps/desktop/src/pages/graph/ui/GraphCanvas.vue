<script setup lang="ts">
import '@vue-flow/core/dist/style.css';
import { computed, nextTick, provide, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VueFlow, useVueFlow } from '@vue-flow/core';
import type { UnitId } from '@lms/engine-contract';
import { buildEdges, buildNodes, neighborInDirection } from '../lib/flow.ts';
import type { Direction } from '../lib/flow.ts';
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/layout.ts';
import type { Point } from '../lib/layout.ts';
import { STATUS_VIEW, legendStatuses } from '../lib/view.ts';
import type { GraphView } from '../lib/view.ts';
import { GRAPH_CONTEXT } from '../model/context.ts';
import type { LaidOut } from '../model/use-layout.ts';
import CourseFrame from './CourseFrame.vue';
import LessonNode from './LessonNode.vue';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 1.5;
const FIT_PADDING = 0.08;
const FOCUS_ZOOM = 0.6;
const FOCUS_FRAMES = 6;
const ZOOM_STEP_MS = 150;

const props = defineProps<{
  /** Вид с актуальным прогрессом. */
  view: GraphView;
  /** Раскладка структуры; узлы и рёбра строятся по её структуре. */
  laidOut: LaidOut;
  selectedId: UnitId | null;
  showCovers: boolean;
}>();
const emit = defineEmits<{ select: [id: UnitId] }>();

const { t, n } = useI18n();
const flowId = `graph-${useId()}`;
const { fitBounds, setCenter, zoomIn, zoomOut, viewport, dimensions } =
  useVueFlow(flowId);

const root = ref<HTMLElement | null>(null);
const activeId = ref<UnitId | null>(null);

const structure = computed(() => props.laidOut.structure);
const layout = computed(() => props.laidOut.layout);
const nodes = computed(() => buildNodes(structure.value, layout.value));
const edges = computed(() =>
  buildEdges(structure.value, props.showCovers, (weight) =>
    t('graph.edge.weight', { weight: n(weight, { style: 'percent' }) }),
  ),
);
const legend = computed(() => legendStatuses(props.view));

const firstLessonId = computed(
  () =>
    layout.value.frames.flatMap(({ local }) => [...local.keys()])[0] ?? null,
);
const tabStopId = computed(() => {
  const known = (id: UnitId | null) =>
    id !== null && layout.value.absolute.has(id) ? id : null;
  return (
    known(activeId.value) ?? known(props.selectedId) ?? firstLessonId.value
  );
});

const fit = () => {
  const frames = layout.value.frames;
  if (frames.length === 0) return Promise.resolve(false);
  const width = Math.max(...frames.map((frame) => frame.x + frame.width));
  const last = frames[frames.length - 1];
  const height = last ? last.y + last.height : 0;
  return fitBounds(
    { x: 0, y: 0, width, height },
    { padding: FIT_PADDING, duration: 0 },
  );
};

const isVisible = ({ x, y }: Point) => {
  const { x: shiftX, y: shiftY, zoom } = viewport.value;
  const left = x * zoom + shiftX;
  const top = y * zoom + shiftY;
  return (
    left >= 0 &&
    top >= 0 &&
    left + NODE_WIDTH * zoom <= dimensions.value.width &&
    top + NODE_HEIGHT * zoom <= dimensions.value.height
  );
};

/** Сдвигает вид к уроку, только если он за пределами окна. */
const reveal = async (id: UnitId) => {
  const point = layout.value.absolute.get(id);
  if (!point || isVisible(point)) return;
  await setCenter(point.x + NODE_WIDTH / 2, point.y + NODE_HEIGHT / 2, {
    zoom: Math.max(viewport.value.zoom, FOCUS_ZOOM),
    duration: 0,
  });
};

/** Урок за окном не отрисован (`onlyRenderVisibleElements`): ждём его после сдвига. */
const focusLesson = async (id: UnitId) => {
  activeId.value = id;
  await reveal(id);
  for (let frame = 0; frame < FOCUS_FRAMES; frame++) {
    await nextTick();
    const element = root.value?.querySelector<HTMLElement>(
      `[data-lesson="${CSS.escape(id)}"]`,
    );
    if (element) {
      element.focus();
      return;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
};

const move = (from: UnitId, direction: Direction) => {
  const next = neighborInDirection(layout.value.absolute, from, direction);
  if (next !== null) void focusLesson(next);
};

const onFocusIn = ({ target }: FocusEvent) => {
  if (target instanceof HTMLElement && target.dataset.lesson) {
    activeId.value = target.dataset.lesson;
  }
};

provide(GRAPH_CONTEXT, {
  view: computed(() => props.view),
  selectedId: computed(() => props.selectedId),
  tabStopId,
  select: (id) => {
    activeId.value = id;
    emit('select', id);
  },
  move,
});

watch(
  () => props.selectedId,
  (id) => id !== null && void reveal(id),
);
watch(structure, () => void nextTick(fit), { immediate: true });

const controls = computed(() => [
  {
    icon: 'mdi-plus',
    label: t('graph.controls.zoomIn'),
    act: () => zoomIn({ duration: ZOOM_STEP_MS }),
  },
  {
    icon: 'mdi-minus',
    label: t('graph.controls.zoomOut'),
    act: () => zoomOut({ duration: ZOOM_STEP_MS }),
  },
  {
    icon: 'mdi-fit-to-screen-outline',
    label: t('graph.controls.fit'),
    act: fit,
  },
]);
</script>

<template>
  <div
    ref="root"
    class="graph-canvas"
    role="group"
    :aria-label="t('graph.canvas')"
    @focusin="onFocusIn"
  >
    <VueFlow
      :id="flowId"
      :nodes="nodes"
      :edges="edges"
      :min-zoom="MIN_ZOOM"
      :max-zoom="MAX_ZOOM"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :nodes-focusable="false"
      :edges-focusable="false"
      :elements-selectable="false"
      :zoom-on-double-click="false"
      :delete-key-code="null"
      disable-keyboard-a11y
      only-render-visible-elements
    >
      <template #node-lesson="nodeProps">
        <LessonNode v-bind="nodeProps" />
      </template>
      <template #node-course="nodeProps">
        <CourseFrame v-bind="nodeProps" />
      </template>
    </VueFlow>

    <div class="controls" role="group" :aria-label="t('graph.controls.label')">
      <v-btn
        v-for="control in controls"
        :key="control.icon"
        icon
        size="small"
        variant="tonal"
        :aria-label="control.label"
        @click="control.act"
      >
        <v-icon :icon="control.icon" />
        <v-tooltip activator="parent" location="left">
          {{ control.label }}
        </v-tooltip>
      </v-btn>
    </div>

    <v-card
      class="legend pa-3"
      role="group"
      :aria-label="t('graph.legend.title')"
    >
      <div class="overline-label mb-2">{{ t('graph.legend.title') }}</div>
      <ul class="legend-list">
        <li
          v-for="status in legend"
          :key="status"
          class="d-flex align-center ga-2"
        >
          <v-icon
            :icon="STATUS_VIEW[status].icon"
            :color="STATUS_VIEW[status].color"
            size="18"
          />
          <span class="text-label-large">
            {{ t(`graph.status.${status}`) }}
          </span>
          <v-tooltip activator="parent" location="right">
            {{ t(`graph.statusHint.${status}`) }}
          </v-tooltip>
        </li>
      </ul>
    </v-card>
  </div>
</template>

<style scoped>
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgb(var(--v-theme-background));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
}

/* тема Vue Flow — токены Vuetify; цвет стрелок (`currentColor`) идёт отсюда */
.graph-canvas :deep(.vue-flow) {
  color: rgb(var(--v-theme-on-surface-variant));
}

.graph-canvas :deep(.vue-flow__edge-path) {
  stroke: currentColor;
  stroke-width: 1.5;
}

.graph-canvas :deep(.edge-cover .vue-flow__edge-path) {
  stroke-dasharray: 6 4;
}

.graph-canvas :deep(.vue-flow__edge-text) {
  font-size: 11px;
  fill: rgb(var(--v-theme-on-surface));
}

.graph-canvas :deep(.vue-flow__edge-textbg) {
  fill: rgb(var(--v-theme-surface));
}

.controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 10;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  list-style: none;
}
</style>
