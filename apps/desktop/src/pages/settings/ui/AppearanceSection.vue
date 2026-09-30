<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { LocaleMode, ThemeMode } from '@lms/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { useAppearanceSettings } from '../model/appearance.ts';
import SectionHeader from './SectionHeader.vue';

interface ThemeOption {
  mode: ThemeMode;
  icon: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { mode: 'system', icon: 'mdi-laptop' },
  { mode: 'light', icon: 'mdi-white-balance-sunny' },
  { mode: 'dark', icon: 'mdi-weather-night' },
];

const LOCALE_OPTIONS: LocaleMode[] = ['system', 'ru', 'en'];

const { t } = useI18n();
const { mode, localeMode, error, select, selectLocale } =
  useAppearanceSettings(useEngine());
</script>

<template>
  <section>
    <SectionHeader
      :title="t('settings.appearance.title')"
      :subtitle="t('settings.appearance.subtitle')"
    />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
      {{ error }}
    </v-alert>

    <v-card class="pa-5 mb-6">
      <h3 class="text-title-large font-weight-bold mb-4">
        {{ t('settings.appearance.theme.title') }}
      </h3>
      <v-btn-toggle
        :model-value="mode"
        mandatory
        color="primary"
        variant="outlined"
        divided
        class="theme-toggle"
        :aria-label="t('settings.appearance.theme.label')"
        @update:model-value="select"
      >
        <v-btn
          v-for="option in THEME_OPTIONS"
          :key="option.mode"
          :value="option.mode"
          :prepend-icon="option.icon"
        >
          {{ t(`settings.appearance.theme.${option.mode}`) }}
        </v-btn>
      </v-btn-toggle>
    </v-card>

    <v-card class="pa-5">
      <h3 class="text-title-large font-weight-bold mb-4">
        {{ t('settings.appearance.language.title') }}
      </h3>
      <v-btn-toggle
        :model-value="localeMode"
        mandatory
        color="primary"
        variant="outlined"
        divided
        class="theme-toggle"
        :aria-label="t('settings.appearance.language.label')"
        @update:model-value="selectLocale"
      >
        <v-btn v-for="option in LOCALE_OPTIONS" :key="option" :value="option">
          {{ t(`settings.appearance.language.${option}`) }}
        </v-btn>
      </v-btn-toggle>
    </v-card>
  </section>
</template>

<style scoped>
.theme-toggle {
  height: auto;
}

.theme-toggle :deep(.v-btn) {
  padding-block: 12px;
}
</style>
