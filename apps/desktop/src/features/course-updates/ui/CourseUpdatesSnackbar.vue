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

const open = computed({
  get: () => shown.value.length > 0,
  set: (value: boolean) => {
    if (!value) dismiss();
  },
});
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
  <v-snackbar
    v-model="open"
    timeout="15000"
    role="status"
    data-testid="course-updates-notice"
  >
    <span class="notice-text">{{ text }}</span>
    <template #actions>
      <v-btn variant="text" class="font-weight-bold" @click="openCourses">
        {{ t('courseUpdates.notice.open') }}
      </v-btn>
      <v-btn variant="text" @click="open = false">
        {{ t('courseUpdates.notice.close') }}
      </v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
.notice-text {
  overflow-wrap: anywhere;
}
</style>
