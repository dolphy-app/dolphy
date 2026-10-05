<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { CourseSummary } from '@/entities/course';
import { useCourseScope } from '@/features/course-scope';
import {
  CheckOutcomeAlert,
  CheckUpdatesButton,
  CourseUpdatesBanner,
  useCourseUpdates,
} from '@/features/course-updates';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { CourseGraphDialog } from '@/widgets/course-graph';
import {
  COURSE_SORTS,
  STATE_FILTERS,
  filterCourses,
  recommendCourse,
} from '../model/courses-view.ts';
import type { CourseFilters } from '../model/courses-view.ts';
import AddRepositoryDialog from './AddRepositoryDialog.vue';
import CourseCard from './CourseCard.vue';

/** Цвета плиток-инициалов по кругу, в порядке библиотеки: соседние курсы различимы. */
const TONES = ['primary', 'secondary', 'info'] as const;

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const scope = useCourseScope();
const courseUpdates = useCourseUpdates();

const filters = reactive<CourseFilters>({
  query: '',
  state: 'all',
  sort: 'name',
});

const visible = computed(() => filterCourses(scope.courses.value, filters));
const toneById = computed(
  () =>
    new Map(
      scope.courses.value.map(({ id }, index) => [
        id,
        TONES[index % TONES.length] ?? 'primary',
      ]),
    ),
);
const toneOf = (id: string) => toneById.value.get(id) ?? 'primary';
// предлагаем курс, только пока фокуса нет: иначе главное действие — у курса в фокусе
const recommendedId = computed(() =>
  scope.activeId.value === null ? recommendCourse(scope.courses.value) : null,
);

const stateItems = computed(() =>
  STATE_FILTERS.map((value) => ({ value, title: t(`courses.state.${value}`) })),
);
const sortItems = computed(() =>
  COURSE_SORTS.map((value) => ({ value, title: t(`courses.sort.${value}`) })),
);

/** «Учить»: курс становится единственным в плане дня. */
const study = async (course: CourseSummary) => {
  await scope.select(course.id);
  await router.push({ name: ROUTE.dailyPlan });
};
/** Вход-тест по курсу: `?course=` выбирает курс. */
const checkKnowledge = (course: CourseSummary) =>
  router.push({ name: ROUTE.placement, query: { course: course.id } });
const openPlan = () => router.push({ name: ROUTE.dailyPlan });

/** Граф курса в окне поверх экрана; в данные лезет, только пока окно смонтировано. */
const graphCourse = ref<CourseSummary | null>(null);
/** Кнопка, открывшая граф: после закрытия фокус возвращается на неё. */
let graphTrigger: HTMLElement | null = null;
const openGraph = (course: CourseSummary) => {
  graphTrigger =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  graphCourse.value = course;
};
const closeGraph = async () => {
  graphCourse.value = null;
  await nextTick();
  graphTrigger?.focus();
  graphTrigger = null;
};
// `?graph=` — переход по ссылке (например, с итога входного теста): открываем
// граф курса и убираем параметр, чтобы он не открыл граф снова
watch(
  () => [route.query.graph, scope.courses.value.length] as const,
  async ([graph, count]) => {
    if (typeof graph !== 'string' || graph === '' || count === 0) return;
    graphCourse.value =
      scope.courses.value.find(({ id }) => id === graph) ?? null;
    await router.replace({ query: { ...route.query, graph: undefined } });
  },
  { immediate: true },
);

const gitDialog = ref(false);
const addedNotice = ref<number | null>(null);
const noticeOpen = computed({
  get: () => addedNotice.value !== null,
  set: (value: boolean) => {
    if (!value) addedNotice.value = null;
  },
});
</script>

<template>
  <v-container max-width="1200" class="pa-8">
    <PageHeader :title="t('courses.title')" :subtitle="t('courses.subtitle')">
      <template #actions>
        <div class="d-flex flex-wrap ga-2">
          <CheckUpdatesButton />
          <v-btn
            v-if="scope.activeId.value !== null"
            variant="text"
            prepend-icon="mdi-close"
            @click="scope.select(null)"
          >
            {{ t('courses.clearFocus') }}
          </v-btn>
          <!-- заливка на экране одна — у курса в фокусе, поэтому тональная -->
          <v-btn
            variant="tonal"
            color="primary"
            data-tour="courses-git"
            prepend-icon="mdi-source-branch-plus"
            @click="gitDialog = true"
          >
            {{ t('courses.git.open') }}
          </v-btn>
        </div>
      </template>
    </PageHeader>

    <v-alert
      v-if="scope.error.value"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="scope.error.value"
    >
      <template #append>
        <v-btn variant="text" @click="scope.refresh">
          {{ t('common.retry') }}
        </v-btn>
      </template>
    </v-alert>

    <CheckOutcomeAlert />
    <CourseUpdatesBanner />

    <div class="toolbar mb-6">
      <v-text-field
        v-model="filters.query"
        class="search"
        prepend-inner-icon="mdi-magnify"
        :label="t('courses.search')"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
      />
      <v-select
        v-model="filters.state"
        class="select"
        :items="stateItems"
        :label="t('courses.filter.state')"
        variant="outlined"
        density="comfortable"
        hide-details
      />
      <v-select
        v-model="filters.sort"
        class="select"
        :items="sortItems"
        :label="t('courses.filter.sort')"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </div>

    <v-card v-if="scope.courses.value.length === 0" class="pa-4">
      <v-empty-state
        icon="mdi-bookshelf"
        :title="t('courses.empty.title')"
        :text="t('courses.empty.text')"
      />
    </v-card>
    <v-card v-else-if="visible.length === 0" class="pa-4">
      <v-empty-state
        icon="mdi-magnify-close"
        :title="t('courses.noMatches.title')"
        :text="t('courses.noMatches.text')"
      />
    </v-card>

    <ul v-else class="grid">
      <li v-for="course in visible" :key="course.id">
        <CourseCard
          :course="course"
          :tone="toneOf(course.id)"
          :focused="scope.activeId.value === course.id"
          :recommended="recommendedId === course.id"
          :update-available="courseUpdates.updateOf(course.id) !== undefined"
          @study="study(course)"
          @open-plan="openPlan"
          @check="checkKnowledge(course)"
          @graph="openGraph(course)"
        />
      </li>
    </ul>

    <AddRepositoryDialog v-model="gitDialog" @added="addedNotice = $event" />
    <CourseGraphDialog
      v-if="graphCourse"
      :key="graphCourse.id"
      :course="graphCourse"
      @closed="closeGraph"
    />
    <v-snackbar v-model="noticeOpen" timeout="6000" role="status">
      {{ t('courses.git.added', { n: addedNotice ?? 0 }) }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.search {
  flex: 1 1 16rem;
}

.select {
  flex: 0 1 12rem;
  min-width: 10rem;
}

/* колонки по ширине контента, а не окна: боковое меню не ломает сетку */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 1rem;
  padding: 0;
  list-style: none;
}
</style>
