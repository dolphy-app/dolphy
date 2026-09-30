<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { UnitId } from '@spirula/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { CourseScopeSwitcher, useCourseScope } from '@/features/course-scope';
import { useGraph } from '../model/graph.ts';
import { useLayout } from '../model/use-layout.ts';
import GraphCanvas from './GraphCanvas.vue';
import LessonPanel from './LessonPanel.vue';

const { t } = useI18n();
const engine = useEngine();
const route = useRoute();
const router = useRouter();
const scope = useCourseScope();

// `?course=` — переход по ссылке: курс становится выбранным (как в «Курсах»),
// параметр убираем, дальше курс переключает переключатель
watch(
  () => route.query.course,
  async (course) => {
    if (typeof course !== 'string' || course === '') return;
    if (scope.courses.value.some(({ id }) => id === course)) {
      await scope.select(course);
    }
    await router.replace({ query: { ...route.query, course: undefined } });
  },
  { immediate: true },
);

const courses = computed(() =>
  scope.courses.value
    .filter(
      ({ id }) => scope.activeId.value === null || id === scope.activeId.value,
    )
    .map(({ id, name }) => ({ id, name })),
);
// курсы приходят заново на каждое событие прогресса: граф грузим по составу
const courseKey = computed(() =>
  courses.value.map(({ id, name }) => `${id}\u0000${name}`).join('\n'),
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
  <v-container fluid class="pa-8">
    <PageHeader :title="t('graph.title')" :subtitle="t('graph.subtitle')">
      <CourseScopeSwitcher class="mt-4" />
      <template #actions>
        <v-switch
          v-model="showCovers"
          :label="t('graph.showCovers')"
          color="primary"
          density="comfortable"
          hide-details
        />
      </template>
    </PageHeader>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="errorText"
    >
      <template #append>
        <v-btn variant="text" @click="reload">{{ t('common.retry') }}</v-btn>
      </template>
    </v-alert>

    <v-progress-linear v-if="loading || computing" indeterminate rounded />

    <v-card v-else-if="scope.courses.value.length === 0" class="pa-4">
      <v-empty-state
        icon="mdi-bookshelf"
        :title="t('graph.empty.noCourses.title')"
        :text="t('graph.empty.noCourses.text')"
      />
    </v-card>
    <v-card v-else-if="view && !hasLessons" class="pa-4">
      <v-empty-state
        icon="mdi-graph-outline"
        :title="t('graph.empty.noLessons.title')"
        :text="t('graph.empty.noLessons.text')"
      />
    </v-card>

    <template v-if="view && laidOut && hasLessons">
      <v-alert
        v-if="view.truncated"
        type="warning"
        variant="tonal"
        class="mb-4"
        :text="t('graph.truncated')"
      />
      <v-alert
        v-if="!hasDependencies"
        type="info"
        variant="tonal"
        class="mb-4"
        :text="t('graph.noDependencies')"
      />
      <div class="workspace" :class="{ 'with-panel': selected }">
        <GraphCanvas
          class="canvas"
          :view="view"
          :laid-out="laidOut"
          :selected-id="selectedId"
          :show-covers="showCovers"
          @select="selectedId = $event"
        />
        <LessonPanel
          v-if="selected"
          :lesson="selected"
          :course="selectedCourse"
          :view="view"
          @close="selectedId = null"
          @select="selectedId = $event"
          @study="study"
        />
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  height: max(32rem, calc(100vh - 20rem));
}

.with-panel {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
}

.canvas {
  min-height: 0;
}
</style>
