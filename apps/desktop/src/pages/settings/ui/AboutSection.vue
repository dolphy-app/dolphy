<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useOnboardingTour } from '@/features/onboarding-tour';
import HelpHint from '@/shared/ui/HelpHint.vue';
import { useEngine } from '@/shared/api/engine';
import { formatBytes, formatUptime } from '../lib/format.ts';
import { useEngineInfo } from '../model/engine-info.ts';
import SectionHeader from './SectionHeader.vue';

interface Fact {
  label: string;
  value: string;
}

const { t, locale } = useI18n();
const tour = useOnboardingTour();

const { info, error } = useEngineInfo(useEngine());
const initialLoading = computed(() => !info.value && !error.value);

const engineFacts = computed<Fact[]>(() => {
  if (!info.value) return [];
  const { diagnostics } = info.value;
  return [
    {
      label: t('settings.about.engine.version'),
      value: diagnostics.engineVersion,
    },
    {
      label: t('settings.about.engine.contractVersion'),
      value: String(diagnostics.contractVersion),
    },
    {
      label: t('settings.about.engine.uptime'),
      value: formatUptime(diagnostics.uptimeMs, locale.value),
    },
    {
      label: t('settings.about.engine.entryCount'),
      value: String(diagnostics.entryCount),
    },
    ...(diagnostics.dbBytes === undefined
      ? []
      : [
          {
            label: t('settings.about.engine.dbSize'),
            value: formatBytes(diagnostics.dbBytes, locale.value),
          },
        ]),
  ];
});

const scorerFacts = computed<Fact[]>(() => {
  if (!info.value) return [];
  const { scorer } = info.value;
  return [
    {
      label: t('settings.about.scorer.memoryModel'),
      value: scorer.memoryModelId,
    },
    { label: t('settings.about.scorer.kind'), value: scorer.kind },
    {
      label: t('settings.about.scorer.ratingMap'),
      value: t(`settings.about.ratingMap.${scorer.ratingMap}`),
    },
    {
      label: t('settings.about.scorer.numTrials'),
      value: String(scorer.numTrials),
    },
    {
      label: t('settings.about.scorer.parameters'),
      value: scorer.parametersHash,
    },
  ];
});
</script>

<template>
  <section>
    <SectionHeader
      :title="t('settings.about.title')"
      :subtitle="t('settings.about.subtitle')"
    />

    <v-card class="pa-5 mb-6 d-flex align-center justify-space-between ga-4">
      <div>
        <h3 class="text-title-large font-weight-bold">
          {{ t('tour.replay.title') }}
        </h3>
        <p class="text-body-medium text-medium-emphasis mt-1">
          {{ t('tour.replay.text') }}
        </p>
      </div>
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-map-marker-path"
        class="flex-shrink-0"
        data-focus-key="tour-replay"
        :disabled="!tour.canStart()"
        @click="tour.start()"
      >
        {{ t('tour.replay.button') }}
      </v-btn>
    </v-card>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
      {{ error }}
    </v-alert>

    <v-progress-linear v-if="initialLoading" indeterminate rounded />

    <template v-else-if="info">
      <v-card class="pa-5 mb-6">
        <h3 class="text-title-large font-weight-bold mb-2">
          {{ t('settings.about.engine.title') }}
        </h3>
        <v-list bg-color="transparent" density="compact">
          <v-list-item v-for="fact in engineFacts" :key="fact.label">
            <template #title>
              <span class="text-body-medium text-medium-emphasis">
                {{ fact.label }}
              </span>
            </template>
            <template #append>
              <span class="text-body-medium font-weight-medium">
                {{ fact.value }}
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card class="pa-5">
        <h3
          class="d-flex align-center ga-1 text-title-large font-weight-bold mb-2"
        >
          {{ t('settings.about.scorer.title') }}
          <HelpHint :text="t('settings.about.scorer.hint')" />
        </h3>
        <v-list bg-color="transparent" density="compact">
          <v-list-item v-for="fact in scorerFacts" :key="fact.label">
            <template #title>
              <span class="text-body-medium text-medium-emphasis">
                {{ fact.label }}
              </span>
            </template>
            <template #append>
              <span class="text-body-medium font-weight-medium">
                {{ fact.value }}
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>
  </section>
</template>
