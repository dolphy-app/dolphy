<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CourseSummary } from '@/entities/course';
import { COURSE_STATE_VIEW } from '../lib/state-view.ts';
import { courseProgress, courseState } from '../model/courses-view.ts';

const props = defineProps<{
  course: CourseSummary;
  /** Цвет темы Vuetify для плитки-инициала. */
  tone: string;
  /** Курс в фокусе: план и повторения только по нему. */
  focused: boolean;
  /** Курс, который предлагаем учить (когда фокуса нет). */
  recommended: boolean;
}>();
const emit = defineEmits<{ study: []; openPlan: [] }>();

const { t } = useI18n();

const state = computed(() => courseState(props.course));
const view = computed(() => COURSE_STATE_VIEW[state.value]);
const percent = computed(() => Math.round(courseProgress(props.course) * 100));
const initial = computed(() =>
  props.course.name.trim().charAt(0).toUpperCase(),
);
/** Одно главное действие на экран: у курса в фокусе или рекомендованного. */
const primary = computed(() => props.focused || props.recommended);
const border = computed(() => (props.focused ? 'primary md' : true));
const ariaCurrent = computed(() => (props.focused ? 'true' : undefined));
const progressColor = computed(() =>
  state.value === 'completed' ? 'success' : 'primary',
);
const actionVariant = computed(() => (primary.value ? 'flat' : 'tonal'));
const actionLabel = computed(() =>
  props.focused ? t('courses.card.openPlan') : t('courses.card.study'),
);
const act = () => (props.focused ? emit('openPlan') : emit('study'));
</script>

<template>
  <v-card
    class="course-card d-flex flex-column pa-5 h-100"
    :border="border"
    :aria-current="ariaCurrent"
  >
    <div class="d-flex align-start ga-4">
      <v-avatar :color="tone" variant="tonal" size="48" rounded="lg">
        <span class="text-title-large font-weight-bold" aria-hidden="true">
          {{ initial }}
        </span>
      </v-avatar>
      <div class="flex-grow-1 min-width-0">
        <div class="d-flex align-start justify-space-between ga-2">
          <h2 class="title text-title-large font-weight-bold">
            {{ course.name }}
          </h2>
          <v-chip
            v-if="focused"
            size="small"
            color="primary"
            variant="flat"
            prepend-icon="mdi-target"
          >
            {{ t('courses.card.focused') }}
          </v-chip>
          <v-chip
            v-else-if="recommended"
            size="small"
            color="primary"
            variant="tonal"
          >
            {{ t('courses.card.recommended') }}
          </v-chip>
        </div>
        <p class="text-body-medium text-medium-emphasis mt-1">
          {{
            t(
              'courses.card.lessons',
              { n: course.lessonCount },
              course.lessonCount,
            )
          }}
          ·
          {{
            t('courses.card.attempts', { n: course.attempts }, course.attempts)
          }}
        </p>
      </div>
    </div>

    <p
      v-if="course.description"
      class="description text-body-medium text-medium-emphasis mt-4"
    >
      {{ course.description }}
    </p>

    <div class="mt-auto pt-5">
      <div class="d-flex align-baseline justify-space-between ga-2 mb-2">
        <span class="text-body-medium">
          {{
            t('courses.card.lessonsDone', {
              done: course.lessonsDone,
              total: course.lessonCount,
            })
          }}
        </span>
        <span class="text-label-large text-medium-emphasis"
          >{{ percent }}%</span
        >
      </div>
      <v-progress-linear
        :model-value="percent"
        height="8"
        rounded
        bg-color="surface-variant"
        bg-opacity="1"
        :color="progressColor"
        :aria-label="
          t('courses.card.lessonsDone', {
            done: course.lessonsDone,
            total: course.lessonCount,
          })
        "
      />
      <div class="d-flex align-center justify-space-between ga-3 mt-3">
        <span class="d-inline-flex align-center ga-2 text-body-medium">
          <v-icon :icon="view.icon" :color="view.color" size="16" />
          {{ t(`courses.state.${state}`) }}
        </span>
        <span
          v-if="course.due > 0"
          class="d-inline-flex align-center ga-2 text-body-medium"
        >
          <v-icon icon="mdi-clock-alert-outline" color="warning" size="16" />
          {{ t('courses.card.due', { n: course.due }, course.due) }}
        </span>
      </div>
    </div>

    <v-btn
      class="mt-5 w-100"
      size="large"
      :variant="actionVariant"
      color="primary"
      append-icon="mdi-arrow-right"
      @click="act"
    >
      {{ actionLabel }}
    </v-btn>
  </v-card>
</template>

<style scoped>
.min-width-0 {
  min-width: 0;
}

.title {
  overflow-wrap: anywhere;
}

.description {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
