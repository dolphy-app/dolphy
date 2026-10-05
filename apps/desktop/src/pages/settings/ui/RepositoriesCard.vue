<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  describeRepositoryError,
  progressPercent,
  shortCommit,
} from '@/entities/repository';
import type { RepositoryProgress } from '@/entities/repository';
import type {
  RepositoryDto,
  RepositoryStatus,
} from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { useRepositories } from '../model/repositories.ts';
import RepositoryCoursesDialog from './RepositoryCoursesDialog.vue';

const { t, d } = useI18n();
const {
  items,
  loaded,
  progress,
  pendingId,
  cancelling,
  busy,
  notice,
  error,
  update,
  remove,
  cancel,
  dismissNotice,
} = useRepositories(useEngine());

const STATUS_ICON: Record<RepositoryStatus, string> = {
  ready: 'mdi-check-circle-outline',
  updating: 'mdi-sync',
  error: 'mdi-alert-circle-outline',
};
const STATUS_COLOR: Record<RepositoryStatus, string> = {
  ready: 'success',
  updating: 'info',
  error: 'error',
};

const noticeOpen = computed({
  get: () => notice.value !== null,
  set: (value: boolean) => {
    if (!value) dismissNotice();
  },
});
const noticeText = computed(() => {
  const current = notice.value;
  if (current === null) return '';
  if (current.kind === 'updated') {
    return t('settings.library.repositories.notice.updated', {
      n: current.courses,
    });
  }
  return t(`settings.library.repositories.notice.${current.kind}`);
});

const statusOf = (repository: RepositoryDto): RepositoryStatus =>
  pendingId.value === repository.id ? 'updating' : repository.status;
const lastErrorOf = (repository: RepositoryDto) =>
  repository.lastError ? describeRepositoryError(repository.lastError) : null;
const progressOf = (id: string): RepositoryProgress | undefined =>
  progress.value[id];
const percentOf = (id: string) => {
  const current = progressOf(id);
  return current === undefined ? null : progressPercent(current);
};

const toRemove = ref<RepositoryDto | null>(null);
const confirmOpen = computed({
  get: () => toRemove.value !== null,
  set: (value: boolean) => {
    if (!value) toRemove.value = null;
  },
});
const confirmRemove = () => {
  const repository = toRemove.value;
  toRemove.value = null;
  if (repository) void remove(repository.id);
};

const toChoose = ref<RepositoryDto | null>(null);
const chooseOpen = computed({
  get: () => toChoose.value !== null,
  set: (value: boolean) => {
    if (!value) toChoose.value = null;
  },
});
const applyCourses = (id: string, courseIds: string[], previewId: string) => {
  void update(id, courseIds, previewId);
};
</script>

<template>
  <v-card class="pa-5 mb-6">
    <h3 class="text-title-large font-weight-bold">
      {{ t('settings.library.repositories.title') }}
    </h3>
    <p class="text-body-medium text-medium-emphasis mt-1">
      {{ t('settings.library.repositories.description') }}
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
      {{ t(error.key) }}
      <ul v-if="error.messages.length > 0" class="messages mt-2">
        <li v-for="message in error.messages" :key="message">
          {{ message }}
        </li>
      </ul>
    </v-alert>

    <v-progress-linear v-if="!loaded" indeterminate rounded class="mt-4" />
    <p
      v-else-if="items.length === 0"
      class="text-body-medium text-medium-emphasis mt-4"
    >
      {{ t('settings.library.repositories.empty') }}
    </p>

    <ul v-else class="list mt-4">
      <li v-for="repository in items" :key="repository.id" class="item">
        <div class="d-flex flex-wrap align-center ga-3">
          <span class="url text-body-large font-weight-medium">
            {{ repository.url }}
          </span>
          <v-chip size="small" variant="tonal" label>
            <v-icon
              start
              size="small"
              :icon="STATUS_ICON[statusOf(repository)]"
              :color="STATUS_COLOR[statusOf(repository)]"
            />
            {{ t(`repository.status.${statusOf(repository)}`) }}
          </v-chip>
          <v-chip
            v-if="repository.availableCommit !== undefined"
            size="small"
            color="warning"
            variant="flat"
            prepend-icon="mdi-update"
          >
            {{ t('repository.updateAvailable') }}
          </v-chip>
          <v-chip
            v-if="repository.skippedCourseIds.length > 0"
            size="small"
            variant="tonal"
            label
          >
            {{
              t('settings.library.repositories.notInstalled', {
                n: repository.skippedCourseIds.length,
              })
            }}
          </v-chip>
          <v-spacer />
          <v-btn
            v-if="pendingId === repository.id"
            variant="text"
            :disabled="cancelling"
            @click="cancel(repository.id)"
          >
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            variant="text"
            prepend-icon="mdi-format-list-checks"
            :disabled="busy"
            :aria-label="
              t('settings.library.repositories.chooseLabel', {
                url: repository.url,
              })
            "
            @click="toChoose = repository"
          >
            {{ t('settings.library.repositories.choose') }}
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-refresh"
            :disabled="busy"
            :loading="pendingId === repository.id"
            :aria-label="
              t('settings.library.repositories.updateLabel', {
                url: repository.url,
              })
            "
            @click="update(repository.id)"
          >
            {{ t('settings.library.repositories.update') }}
          </v-btn>
          <v-btn
            variant="text"
            color="error"
            prepend-icon="mdi-delete-outline"
            :disabled="busy"
            :aria-label="
              t('settings.library.repositories.removeLabel', {
                url: repository.url,
              })
            "
            @click="toRemove = repository"
          >
            {{ t('settings.library.repositories.remove') }}
          </v-btn>
        </div>

        <p class="text-body-medium text-medium-emphasis mt-1">
          {{
            repository.ref ?? t('settings.library.repositories.defaultBranch')
          }}
          ·
          <span class="mono">{{ shortCommit(repository.commit) }}</span>
          · {{ d(repository.fetchedAt, 'shortDateTime') }} ·
          {{
            t('settings.library.repositories.courses', {
              n: repository.courseIds.length,
            })
          }}
        </p>

        <div
          v-if="pendingId === repository.id"
          class="mt-2"
          role="status"
          aria-live="polite"
        >
          <p class="text-body-small mb-1">
            {{
              cancelling
                ? t('settings.library.repositories.cancelling')
                : t(
                    `repository.phase.${progressOf(repository.id)?.phase ?? 'resolve'}`,
                  )
            }}
          </p>
          <v-progress-linear
            :model-value="percentOf(repository.id) ?? 0"
            :indeterminate="percentOf(repository.id) === null"
            rounded
          />
        </div>

        <p
          v-if="lastErrorOf(repository) && pendingId !== repository.id"
          class="text-body-small mt-1"
        >
          {{ t(lastErrorOf(repository)!.key) }}
          {{ lastErrorOf(repository)!.messages[0] }}
        </p>
      </li>
    </ul>

    <v-snackbar v-model="noticeOpen" timeout="5000" role="status">
      {{ noticeText }}
    </v-snackbar>

    <v-dialog v-model="confirmOpen" max-width="480">
      <v-card v-if="toRemove" class="pa-2">
        <v-card-title class="text-title-large font-weight-bold">
          {{ t('settings.library.repositories.confirm.title') }}
        </v-card-title>
        <v-card-text>
          <p class="url mb-2">{{ toRemove.url }}</p>
          <p>{{ t('settings.library.repositories.confirm.text') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" @click="confirmRemove">
            {{ t('settings.library.repositories.remove') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <RepositoryCoursesDialog
      v-model="chooseOpen"
      :repository="toChoose"
      @apply="applyCourses"
    />
  </v-card>
</template>

<style scoped>
.list {
  padding: 0;
  list-style: none;
}

.item {
  padding: 0.75rem 0;
}

.item + .item {
  border-top: 1px solid rgb(var(--v-theme-on-surface), 0.12);
}

.url {
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.messages {
  padding-left: 1.25rem;
  overflow-wrap: anywhere;
}
</style>
