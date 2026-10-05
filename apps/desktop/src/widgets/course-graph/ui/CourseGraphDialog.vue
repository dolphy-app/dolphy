<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { UnitId } from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import type { CourseRef } from '../lib/view.ts';
import { useGraph } from '../model/graph.ts';
import { useLayout } from '../model/use-layout.ts';
import GraphCanvas from './GraphCanvas.vue';
import GraphToolbar from './GraphToolbar.vue';
import LessonPanel from './LessonPanel.vue';

/**
 * Граф одного курса на всё окно. Компонент монтируют, когда граф нужен, и
 * убирают по `closed`: данные и воркер раскладки живут, пока окно открыто.
 */
const props = defineProps<{ course: CourseRef }>();
const emit = defineEmits<{ closed: [] }>();

const { t } = useI18n();
const engine = useEngine();
const router = useRouter();

const open = ref(true);

const courses = computed(() => [
  { id: props.course.id, name: props.course.name },
]);
// курс приходит заново на каждое событие прогресса: граф грузим по составу
const courseKey = computed(
  () => `${props.course.id}\u0000${props.course.name}`,
);

const { view, structure, loading, error, reload } = useGraph(
  engine,
  courses,
  courseKey,
);
const { laidOut, computing, error: layoutError } = useLayout(structure);

const showCovers = ref(false);
const selectedId = ref<UnitId | null>(null);
const selected = computed(() =>
  selectedId.value === null
    ? null
    : (view.value?.lessons.get(selectedId.value) ?? null),
);
const selectedCourse = computed(
  () =>
    view.value?.courses.find(({ id }) => id === selected.value?.courseId) ??
    null,
);
watch(selected, (lesson) => {
  if (lesson === null) selectedId.value = null; // урок пропал из библиотеки
});

const hasLessons = computed(() => (view.value?.lessons.size ?? 0) > 0);
const hasDependencies = computed(
  () => (view.value?.dependencies.length ?? 0) > 0,
);
const errorText = computed(() => error.value ?? layoutError.value);

const study = () => {
  if (!selected.value) return;
  void router.push({
    name: ROUTE.session,
    query: { course: selected.value.courseId },
  });
};
</script>

<template>
  <v-dialog
    v-model="open"
    fullscreen
    :scrim="false"
    transition="dialog-bottom-transition"
    :aria-label="course.name"
    @after-leave="emit('closed')"
  >
    <v-card class="graph-dialog" rounded="0">
      <GraphToolbar :title="course.name" :view="view">
        <template #prepend>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :aria-label="t('graph.close')"
            :title="t('graph.close')"
            @click="open = false"
          />
        </template>
      </GraphToolbar>

      <v-progress-linear v-if="loading || computing" indeterminate />
      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        density="compact"
        rounded="0"
        :text="errorText"
      >
        <template #append>
          <v-btn variant="text" @click="reload">{{ t('common.retry') }}</v-btn>
        </template>
      </v-alert>
      <v-empty-state
        v-else-if="view && !loading && !hasLessons"
        class="empty"
        icon="mdi-graph-outline"
        :title="t('graph.empty.title')"
        :text="t('graph.empty.text')"
      />

      <template v-if="view && laidOut && hasLessons">
        <v-alert
          v-if="view.truncated"
          type="warning"
          variant="tonal"
          density="compact"
          rounded="0"
          :text="t('graph.truncated')"
        />
        <v-alert
          v-if="!hasDependencies"
          type="info"
          variant="tonal"
          density="compact"
          rounded="0"
          :text="t('graph.noDependencies')"
        />

        <div class="workspace" :class="{ 'with-panel': selected }">
          <GraphCanvas
            v-model:show-covers="showCovers"
            class="canvas"
            :view="view"
            :laid-out="laidOut"
            :selected-id="selectedId"
            @select="selectedId = $event"
          />
          <LessonPanel
            v-if="selected"
            class="panel"
            :lesson="selected"
            :course="selectedCourse"
            :view="view"
            @close="selectedId = null"
            @select="selectedId = $event"
            @study="study"
          />
        </div>
      </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.graph-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.empty {
  flex: 1 1 0;
}

.workspace {
  display: grid;
  flex: 1 1 0;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}

.with-panel {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
}

.canvas {
  min-height: 0;
}

/* панель урока — боковая колонка во всю высоту, а не карточка с отступами */
.panel {
  min-height: 0;
  overflow-y: auto;
  border-radius: 0;
  border-inline-start: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
