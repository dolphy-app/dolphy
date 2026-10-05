<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { progressPercent } from '@/entities/repository';
import type { RefIssue, UrlIssue } from '@/entities/repository';
import { RepositoryCoursePicker } from '@/features/repository-courses';
import { useEngine } from '@/shared/api/engine';
import { useAddRepository } from '../model/add-repository.ts';

/** Сколько диагностик сканера показываем: остальные — в «Настройки → Библиотека». */
const SHOWN_MESSAGES = 5;

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ added: [courses: number] }>();

const { t } = useI18n();
const {
  url,
  branch,
  running,
  cancelling,
  progress,
  error,
  urlIssue,
  refIssue,
  step,
  preview,
  selected,
  canConfirm,
  submit,
  confirm,
  back,
  toggle,
  selectAll,
  clear,
  cancel,
  reset,
} = useAddRepository(useEngine());

const percent = computed(() =>
  progress.value === null ? null : progressPercent(progress.value),
);
const phaseLabel = computed(() =>
  progress.value === null
    ? t('repository.phase.resolve')
    : t(`repository.phase.${progress.value.phase}`),
);

const fieldMessages = (
  field: 'url' | 'ref',
  issue: UrlIssue | RefIssue | null,
) => {
  if (issue !== null) return [t(`repository.validation.${issue}`)];
  if (error.value?.field !== field) return [];
  return [t(error.value.key), ...error.value.messages];
};
const urlMessages = computed(() => fieldMessages('url', urlIssue.value));
const refMessages = computed(() => fieldMessages('ref', refIssue.value));

// ошибка без поля — общим блоком
const formError = computed(() =>
  error.value !== null && error.value.field === undefined ? error.value : null,
);
const shownMessages = computed(
  () => formError.value?.messages.slice(0, SHOWN_MESSAGES) ?? [],
);
const hiddenCount = computed(
  () => (formError.value?.messages.length ?? 0) - shownMessages.value.length,
);

watch(open, (isOpen) => {
  if (isOpen) reset();
});

const next = async () => {
  const outcome = step.value === 'source' ? await submit() : await confirm();
  if (outcome.status === 'added') {
    open.value = false;
    emit('added', outcome.repository.courseIds.length);
  } else if (outcome.status === 'cancelled') {
    open.value = false;
  }
};
const close = () => {
  open.value = false;
};
</script>

<template>
  <v-dialog
    v-model="open"
    :max-width="step === 'courses' ? 640 : 560"
    :persistent="running"
  >
    <v-card tag="form" class="pa-2" :aria-busy="running" @submit.prevent="next">
      <v-card-title class="text-title-large font-weight-bold">
        {{
          step === 'courses'
            ? t('courses.git.chooseTitle')
            : t('courses.git.title')
        }}
      </v-card-title>
      <v-card-text>
        <template v-if="step === 'source'">
          <p class="text-body-medium text-medium-emphasis mb-4">
            {{ t('courses.git.description') }}
          </p>
          <v-text-field
            v-model="url"
            :label="t('courses.git.url')"
            :placeholder="t('courses.git.urlPlaceholder')"
            :error-messages="urlMessages"
            :disabled="running"
            inputmode="url"
            autofocus
            class="mb-2"
          />
          <v-text-field
            v-model="branch"
            :label="t('courses.git.ref')"
            :hint="t('courses.git.refHint')"
            :error-messages="refMessages"
            :disabled="running"
            persistent-hint
          />
        </template>
        <template v-else-if="preview">
          <p class="text-body-medium text-medium-emphasis mb-4 url">
            {{ t('courses.git.chooseDescription', { url: preview.url }) }}
          </p>
          <RepositoryCoursePicker
            :courses="preview.courses"
            :selected="selected"
            :disabled="running"
            @toggle="toggle"
            @select-all="selectAll"
            @clear="clear"
          />
        </template>

        <div v-if="running" class="mt-6" role="status" aria-live="polite">
          <p class="text-body-medium mb-2">
            {{ cancelling ? t('courses.git.cancelling') : phaseLabel }}
          </p>
          <v-progress-linear
            :model-value="percent ?? 0"
            :indeterminate="percent === null"
            rounded
            :aria-label="phaseLabel"
          />
        </div>

        <v-alert
          v-if="formError"
          type="error"
          variant="tonal"
          class="mt-6"
          :text="t(formError.key)"
        >
          <ul v-if="shownMessages.length > 0" class="messages mt-2">
            <li v-for="message in shownMessages" :key="message">
              {{ message }}
            </li>
          </ul>
          <p v-if="hiddenCount > 0" class="mt-1">
            {{ t('courses.git.moreMessages', { n: hiddenCount }) }}
          </p>
          <p v-if="formError.path" class="mt-1">
            {{ t('repository.error.path', { path: formError.path }) }}
          </p>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="step === 'courses' && !running"
          variant="text"
          prepend-icon="mdi-arrow-left"
          @click="back"
        >
          {{ t('courses.git.back') }}
        </v-btn>
        <v-spacer />
        <v-btn
          v-if="running"
          variant="text"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </v-btn>
        <v-btn v-else variant="text" @click="close">
          {{ t('courses.git.close') }}
        </v-btn>
        <v-btn
          type="submit"
          color="primary"
          variant="flat"
          :loading="running"
          :disabled="running || (step === 'courses' && !canConfirm)"
        >
          {{
            step === 'courses' ? t('courses.git.submit') : t('courses.git.next')
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.messages {
  padding-left: 1.25rem;
  overflow-wrap: anywhere;
}

.url {
  overflow-wrap: anywhere;
}
</style>
