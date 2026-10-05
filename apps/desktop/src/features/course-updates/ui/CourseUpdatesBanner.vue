<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { progressPercent, shortCommit } from '@/entities/repository';
import { useCourseUpdates } from '../model/use-course-updates.ts';
import type { CourseUpdate } from '../lib/updates.ts';

const { t } = useI18n();
const store = useCourseUpdates();

const courses = (update: CourseUpdate) =>
  update.repository.courseIds.map(store.courseName).join(', ');
/** Адрес без схемы: `github.com/dolphy-app/dolphy-courses`. */
const source = ({ repository }: CourseUpdate) =>
  repository.url.replace(/^https?:\/\//, '');
const percentOf = (id: string) => {
  const current = store.progress.value[id];
  return current === undefined ? null : progressPercent(current);
};
</script>

<template>
  <div
    v-if="store.updates.value.length > 0"
    class="d-flex flex-column ga-3 mb-6"
  >
    <v-alert
      v-for="update in store.updates.value"
      :key="update.repository.id"
      type="info"
      variant="tonal"
      icon="mdi-update"
      :data-testid="`course-update-${update.repository.id}`"
    >
      <p class="text-body-large font-weight-medium">
        {{ t('courseUpdates.banner.text', { courses: courses(update) }) }}
      </p>
      <p class="source text-body-small text-medium-emphasis mt-1">
        {{ source(update) }} ·
        <span class="mono">{{ shortCommit(update.repository.commit) }}</span>
        →
        <span class="mono">{{ shortCommit(update.availableCommit) }}</span>
      </p>

      <div
        v-if="store.pendingId.value === update.repository.id"
        class="mt-2"
        role="status"
        aria-live="polite"
      >
        <p class="text-body-small mb-1">
          {{
            t(
              `repository.phase.${store.progress.value[update.repository.id]?.phase ?? 'resolve'}`,
            )
          }}
        </p>
        <v-progress-linear
          :model-value="percentOf(update.repository.id) ?? 0"
          :indeterminate="percentOf(update.repository.id) === null"
          rounded
        />
      </div>

      <p
        v-if="store.failure.value?.id === update.repository.id"
        class="d-flex align-start ga-2 text-body-medium text-error mt-2"
        role="alert"
      >
        <v-icon icon="mdi-alert-circle-outline" size="18" class="mt-1" />
        <span>
          {{ t(store.failure.value.view.key) }}
          {{ store.failure.value.view.messages[0] }}
        </span>
      </p>

      <template #append>
        <!-- заливка на экране одна — у курса в фокусе, поэтому тональная -->
        <v-btn
          variant="tonal"
          prepend-icon="mdi-refresh"
          :disabled="store.pendingId.value !== null"
          :loading="store.pendingId.value === update.repository.id"
          :aria-label="
            t('courseUpdates.banner.updateLabel', {
              repository: source(update),
            })
          "
          @click="store.update(update.repository.id)"
        >
          {{ t('courseUpdates.banner.update') }}
        </v-btn>
      </template>
    </v-alert>
  </div>
</template>

<style scoped>
.source {
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
