<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PlacementResultView } from '../lib/progress.ts';

interface Section {
  key: 'known' | 'uncertain' | 'unknown';
  icon: string;
  /** Цвет темы Vuetify: только у значка, текст нейтральный. */
  color: string;
}

const SECTIONS: Section[] = [
  { key: 'known', icon: 'mdi-check-circle-outline', color: 'success' },
  { key: 'uncertain', icon: 'mdi-help-circle-outline', color: 'warning' },
  { key: 'unknown', icon: 'mdi-circle-outline', color: 'secondary' },
];

defineProps<{ result: PlacementResultView }>();
defineEmits<{ toPlan: []; openGraph: [] }>();
const { t } = useI18n();
</script>

<template>
  <v-card class="pa-8">
    <div class="text-center">
      <v-icon icon="mdi-check-circle-outline" size="56" class="mb-4" />
      <h1 class="text-headline-medium font-weight-bold">
        {{ t('placement.finished.title') }}
      </h1>
      <p class="d-flex align-center justify-center ga-2 text-body-large mt-3">
        <v-icon icon="mdi-rocket-launch-outline" size="20" />
        {{
          t(
            'placement.finished.frontier',
            { n: result.frontier },
            result.frontier,
          )
        }}
      </p>
    </div>

    <v-alert
      v-if="result.duplicate"
      type="info"
      variant="tonal"
      class="mt-6"
      :text="t('placement.finished.duplicate')"
    />

    <section v-for="section in SECTIONS" :key="section.key" class="mt-8">
      <h2 class="d-flex align-center ga-2 text-title-large font-weight-bold">
        <v-icon :icon="section.icon" :color="section.color" size="22" />
        {{ t(`placement.finished.${section.key}`) }}
        <v-chip size="small" variant="tonal">
          {{ result[section.key].length }}
        </v-chip>
      </h2>
      <ul v-if="result[section.key].length" class="lessons mt-3">
        <li
          v-for="lesson in result[section.key]"
          :key="lesson.id"
          class="text-body-large"
        >
          {{ lesson.name }}
        </li>
      </ul>
      <p v-else class="text-body-medium text-medium-emphasis mt-3">
        {{ t('placement.finished.empty') }}
      </p>
    </section>

    <p class="text-body-medium text-medium-emphasis mt-8">
      {{
        t(
          'placement.finished.attempts',
          { n: result.attemptsWritten },
          result.attemptsWritten,
        )
      }}
    </p>

    <div class="d-flex flex-wrap ga-3 mt-6">
      <v-btn
        color="primary"
        variant="flat"
        size="large"
        append-icon="mdi-arrow-right"
        @click="$emit('toPlan')"
      >
        {{ t('placement.finished.toPlan') }}
      </v-btn>
      <v-btn
        variant="tonal"
        size="large"
        prepend-icon="mdi-graph-outline"
        @click="$emit('openGraph')"
      >
        {{ t('placement.finished.openGraph') }}
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.lessons {
  padding-left: 1.5rem;
  columns: 2 16rem;
}

.lessons li {
  break-inside: avoid;
  padding-block: 0.15rem;
}
</style>
