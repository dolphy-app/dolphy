<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LocaleMode } from '@spirula-app/engine-contract';
import { useContributions, useEngine } from '@/shared/api/engine';
import { vuetifyThemeName } from '@/shared/lib/extension-themes.ts';
import { useAppearanceSettings } from '../model/appearance.ts';
import SectionHeader from './SectionHeader.vue';
import SettingsRow from './SettingsRow.vue';
import ThemeTile from './ThemeTile.vue';

const LOCALE_MODES: LocaleMode[] = ['system', 'ru', 'en'];

const { t } = useI18n();
const { themes } = useContributions();
const { mode, localeMode, error, select, selectLocale } = useAppearanceSettings(
  useEngine(),
  themes,
);

const themeTiles = computed(() => [
  ...(['system', 'light', 'dark'] as const).map((id) => ({
    id,
    label: t(`settings.appearance.theme.${id}`),
    caption: '',
    names: id === 'system' ? ['light', 'dark'] : [id],
  })),
  ...themes.map((theme) => ({
    id: theme.id,
    label: theme.label,
    caption: theme.extensionId,
    names: [vuetifyThemeName(theme.id)],
  })),
]);

const localeItems = computed(() =>
  LOCALE_MODES.map((value) => ({
    value,
    title: t(`settings.appearance.language.${value}`),
  })),
);
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

    <v-card class="px-5 py-4 mb-3">
      <div class="text-title-medium font-weight-bold">
        {{ t('settings.appearance.theme.title') }}
      </div>
      <div class="text-body-medium text-medium-emphasis mb-4">
        {{ t('settings.appearance.theme.description') }}
      </div>
      <div
        class="tiles"
        role="radiogroup"
        :aria-label="t('settings.appearance.theme.label')"
      >
        <ThemeTile
          v-for="tile in themeTiles"
          :key="tile.id"
          :mode="tile.id"
          :theme-names="tile.names"
          :label="tile.label"
          :caption="tile.caption"
          :selected="mode === tile.id"
          @select="select"
        />
      </div>
    </v-card>

    <SettingsRow
      :title="t('settings.appearance.language.title')"
      :description="t('settings.appearance.language.description')"
    >
      <v-select
        class="locale-select"
        :model-value="localeMode"
        :items="localeItems"
        :aria-label="t('settings.appearance.language.label')"
        variant="outlined"
        density="comfortable"
        hide-details
        @update:model-value="selectLocale"
      />
    </SettingsRow>
  </section>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}

.locale-select {
  width: 14rem;
}
</style>
