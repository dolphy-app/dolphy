<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LocaleMode } from '@dolphy-app/engine-contract';
import { useLocaleSelection, useThemeSelection } from '@/shared/api/engine';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useAppearanceSettings } from '../model/appearance.ts';
import { buildThemeTiles } from '../model/theme-tiles.ts';
import SectionHeader from './SectionHeader.vue';
import SettingsRow from './SettingsRow.vue';
import ThemeTile from './ThemeTile.vue';

const LOCALE_MODES: LocaleMode[] = ['system', 'ru', 'en'];

const { t } = useI18n();
const clients = useExtensionClients();
const extensionText = useExtensionText();
const { mode, localeMode, error, select, selectLocale } = useAppearanceSettings(
  useThemeSelection(),
  useLocaleSelection(),
  clients.themes,
);

const themeTiles = computed(() =>
  buildThemeTiles(
    (id) => t(`settings.appearance.theme.${id}`),
    clients.themes.value,
    extensionText.of,
  ),
);

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
          :tooltip="tile.tooltip"
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
