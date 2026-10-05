<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ROUTE } from '@/shared/config/routes.ts';
import { announcementStep } from '../lib/updates.ts';
import type { CourseUpdate } from '../lib/updates.ts';
import { useCourseUpdates } from '../model/use-course-updates.ts';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useCourseUpdates();

/** Показанная пачка: пока она на экране, новые находки ждут своей очереди. */
const shown = shallowRef<readonly CourseUpdate[]>([]);

const dismiss = () => {
  store.markAnnounced(shown.value);
  shown.value = [];
};

const text = computed(() =>
  t('courseUpdates.notice.text', {
    courses: shown.value
      .flatMap(({ repository }) => repository.courseIds)
      .map(store.courseName)
      .join(', '),
  }),
);

watch(
  [() => route.name, () => store.unannounced.value] as const,
  ([name, pending]) => {
    const step = announcementStep(name, shown.value, pending);
    if (step.announce.length > 0) store.markAnnounced(step.announce);
    shown.value = step.shown;
  },
  { immediate: true },
);

const openCourses = () => router.push({ name: ROUTE.courses });
</script>

<template>
  <!-- как плашка безопасного режима: полоса сверху окна, предупреждение несут рамка и значок -->
  <v-system-bar
    v-if="shown.length > 0"
    app
    color="surface-variant"
    :height="48"
    class="course-updates-notice ga-3 px-4"
    role="status"
    data-testid="course-updates-notice"
  >
    <v-icon icon="mdi-update" color="warning" aria-hidden="true" />
    <span class="text-body-medium text-start flex-grow-1 message">
      {{ text }}
    </span>
    <v-btn size="small" variant="flat" color="surface" @click="openCourses">
      {{ t('courseUpdates.notice.open') }}
    </v-btn>
    <v-btn
      icon="mdi-close"
      size="small"
      variant="text"
      :aria-label="t('courseUpdates.notice.close')"
      @click="dismiss"
    />
  </v-system-bar>
</template>

<style scoped>
.course-updates-notice {
  flex-wrap: nowrap;
  border-bottom: 3px solid rgb(var(--v-theme-warning));
}

.message {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
</style>
