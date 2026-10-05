<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RepositoryDto } from '@dolphy-app/engine-contract';
import { progressPercent } from '@/entities/repository';
import { RepositoryCoursePicker } from '@/features/repository-courses';
import { useEngine } from '@/shared/api/engine';
import { useRepositoryCourses } from '../model/repository-courses.ts';

/** Сколько диагностик сканера показываем: остальные — в «Настройки → Библиотека». */
const SHOWN_MESSAGES = 5;

const props = defineProps<{ repository: RepositoryDto | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{
  apply: [id: string, courseIds: string[], previewId: string];
}>();

const { t } = useI18n();
const {
  preview,
  selected,
  loading,
  cancelling,
  progress,
  error,
  canApply,
  load,
  toggle,
  selectAll,
  clear,
  cancel,
  reset,
} = useRepositoryCourses(useEngine());

const percent = computed(() =>
  progress.value === null ? null : progressPercent(progress.value),
);
const phaseLabel = computed(() =>
  progress.value === null
    ? t('repository.phase.resolve')
    : t(`repository.phase.${progress.value.phase}`),
);
const shownMessages = computed(
  () => error.value?.messages.slice(0, SHOWN_MESSAGES) ?? [],
);

watch(open, (isOpen) => {
  if (isOpen && props.repository !== null) void load(props.repository);
  else if (!isOpen) reset();
});

const apply = () => {
  const repository = props.repository;
  if (repository === null || !canApply.value) return;
  const previewId = preview.value?.previewId;
  if (previewId === undefined) return;
  emit('apply', repository.id, [...selected.value], previewId);
  open.value = false;
};
</script>

<template>
  <v-dialog v-model="open" max-width="640">
    <v-card
      v-if="repository"
      tag="form"
      class="pa-2"
      :aria-busy="loading"
      @submit.prevent="apply"
    >
      <v-card-title class="text-title-large font-weight-bold">
        {{ t('settings.library.repositories.chooser.title') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-medium text-medium-emphasis mb-4 url">
          {{ repository.url }}
        </p>
        <p
          v-if="preview !== null"
          class="text-body-medium text-medium-emphasis mb-4"
        >
          {{ t('settings.library.repositories.chooser.hint') }}
        </p>

        <div v-if="loading" role="status" aria-live="polite">
          <p class="text-body-medium mb-2">
            {{
              cancelling
                ? t('settings.library.repositories.cancelling')
                : phaseLabel
            }}
          </p>
          <v-progress-linear
            :model-value="percent ?? 0"
            :indeterminate="percent === null"
            rounded
            :aria-label="phaseLabel"
          />
        </div>

        <RepositoryCoursePicker
          v-else-if="preview !== null"
          :courses="preview.courses"
          :selected="selected"
          @toggle="toggle"
          @select-all="selectAll"
          @clear="clear"
        />

        <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
          {{ t(error.key) }}
          <ul v-if="shownMessages.length > 0" class="messages mt-2">
            <li v-for="message in shownMessages" :key="message">
              {{ message }}
            </li>
          </ul>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="loading"
          variant="text"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </v-btn>
        <v-btn v-else variant="text" @click="open = false">
          {{ t('settings.library.repositories.chooser.close') }}
        </v-btn>
        <v-btn
          type="submit"
          color="primary"
          variant="flat"
          :disabled="!canApply"
        >
          {{ t('settings.library.repositories.chooser.apply') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.url {
  overflow-wrap: anywhere;
}

.messages {
  padding-left: 1.25rem;
  overflow-wrap: anywhere;
}
</style>
