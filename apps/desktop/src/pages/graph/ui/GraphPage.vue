<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { UnitId } from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { CourseScopeSwitcher, useCourseScope } from '@/features/course-scope';
import { pickGraphCourse } from '../lib/course.ts';
import { useGraph } from '../model/graph.ts';
import { useLayout } from '../model/use-layout.ts';
import GraphCanvas from './GraphCanvas.vue';
import GraphToolbar from './GraphToolbar.vue';
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

const courseId = computed(() =>
  pickGraphCourse(scope.courses.value, scope.activeId.value),
);
const courses = computed(() =>
  scope.courses.value
    .filter(({ id }) => id === courseId.value)
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
const ready = computed(
  () => view.value !== null && laidOut.value !== null && hasLessons.value,
);
const masteredText = computed(() => {
  const course = view.value?.courses[0];
  return course
    ? t('graph.frame.mastered', {
        done: course.mastered,
        total: course.lessonIds.length,
      })
    : '';
});

// граф открывается сразу при переходе на экран; закрытое окно возвращается
// кнопкой на странице
const open = ref(true);

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
      <CourseScopeSwitcher
        class="mt-4"
        :allow-all="false"
        :fallback-id="courseId"
      />
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
    <v-card v-else-if="view && ready" class="pa-4">
      <v-empty-state
        icon="mdi-graph-outline"
        :title="view.courses[0]?.name"
        :text="masteredText"
        :action-text="t('graph.open')"
        @click:action="open = true"
      />
    </v-card>

    <!-- граф на весь экран: окно под шапкой страницы было тесным, и граф не помещался -->
    <v-dialog
      :model-value="open && ready"
      fullscreen
      :aria-label="t('graph.title')"
      :scrim="false"
      transition="dialog-bottom-transition"
      @update:model-value="open = $event"
    >
      <v-card v-if="view && laidOut" class="graph-dialog" rounded="0">
        <GraphToolbar :view="view">
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
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.graph-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
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
