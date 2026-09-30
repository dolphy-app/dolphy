<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEngine } from '@/shared/api/engine';
import { useLibrarySettings } from '../model/library.ts';
import SectionHeader from './SectionHeader.vue';

const {
  info,
  draftPaths,
  busy,
  error,
  isDirty,
  reload,
  addPath,
  removePath,
  revert,
  apply,
} = useLibrarySettings(useEngine());

const { t } = useI18n();
const newPath = ref('');

const add = () => {
  if (addPath(newPath.value)) newPath.value = '';
};
</script>

<template>
  <section>
    <SectionHeader
      :title="t('settings.library.title')"
      :subtitle="t('settings.library.subtitle')"
    />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="!info" indeterminate rounded />

    <template v-else>
      <v-card class="pa-5 mb-6">
        <div class="d-flex align-center ga-3">
          <h3 class="text-title-large font-weight-bold">
            {{ t('settings.library.state.title') }}
          </h3>
          <v-chip
            size="small"
            variant="tonal"
            :color="info.state === 'ready' ? 'success' : 'error'"
          >
            {{
              info.state === 'ready'
                ? t('settings.library.state.ready')
                : t('settings.library.state.failed')
            }}
          </v-chip>
          <v-spacer />
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-refresh"
            :loading="busy"
            @click="reload"
          >
            {{ t('settings.library.reload') }}
          </v-btn>
        </div>

        <p class="path text-body-medium text-medium-emphasis mt-3">
          {{ info.root }}
        </p>

        <dl class="d-flex ga-10 mt-5">
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('settings.library.counts.courses') }}
            </dt>
            <dd class="text-headline-small font-weight-bold">
              {{ info.counts.courses }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('settings.library.counts.lessons') }}
            </dt>
            <dd class="text-headline-small font-weight-bold">
              {{ info.counts.lessons }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('settings.library.counts.exercises') }}
            </dt>
            <dd class="text-headline-small font-weight-bold">
              {{ info.counts.exercises }}
            </dd>
          </div>
        </dl>

        <div class="d-flex flex-wrap align-center ga-2 mt-5">
          <v-chip v-if="info.diagnostics.errors > 0" color="error" size="small">
            {{
              t('settings.library.diagnostics.errors', {
                n: info.diagnostics.errors,
              })
            }}
          </v-chip>
          <v-chip
            v-if="info.diagnostics.warnings > 0"
            color="warning"
            size="small"
          >
            {{
              t('settings.library.diagnostics.warnings', {
                n: info.diagnostics.warnings,
              })
            }}
          </v-chip>
          <v-chip
            v-if="info.diagnostics.errors + info.diagnostics.warnings === 0"
            color="success"
            size="small"
            variant="tonal"
          >
            {{ t('settings.library.diagnostics.clean') }}
          </v-chip>
          <span class="text-body-small text-medium-emphasis">
            {{
              t('settings.library.artifact.label', {
                state: t(`settings.library.artifact.${info.artifact}`),
              })
            }}
          </span>
        </div>
      </v-card>

      <v-card class="pa-5">
        <h3 class="text-title-large font-weight-bold">
          {{ t('settings.library.ignored.title') }}
        </h3>
        <p class="text-body-medium text-medium-emphasis mt-1">
          {{ t('settings.library.ignored.description') }}
        </p>

        <v-text-field
          v-model="newPath"
          class="mt-4"
          :label="t('settings.library.ignored.fieldLabel')"
          :placeholder="t('settings.library.ignored.placeholder')"
          hide-details
          append-inner-icon="mdi-plus"
          @click:append-inner="add"
          @keydown.enter.prevent="add"
        />

        <div class="d-flex flex-wrap ga-2 mt-4">
          <v-chip
            v-for="path in draftPaths"
            :key="path"
            closable
            label
            @click:close="removePath(path)"
          >
            {{ path }}
          </v-chip>
          <span
            v-if="draftPaths.length === 0"
            class="text-body-medium text-medium-emphasis"
          >
            {{ t('settings.library.ignored.empty') }}
          </span>
        </div>

        <div class="d-flex ga-3 mt-6">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!isDirty"
            :loading="busy"
            @click="apply"
          >
            {{ t('settings.library.ignored.apply') }}
          </v-btn>
          <v-btn variant="text" :disabled="!isDirty || busy" @click="revert">
            {{ t('settings.library.ignored.revert') }}
          </v-btn>
        </div>
      </v-card>
    </template>
  </section>
</template>

<style scoped>
.path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
</style>
