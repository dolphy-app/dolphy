<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';

interface SectionLink {
  name: string;
  title: string;
  icon: string;
}

const SECTIONS: SectionLink[] = [
  {
    name: ROUTE.settingsLearning,
    title: 'settings.page.nav.learning',
    icon: 'mdi-school-outline',
  },
  {
    name: ROUTE.settingsLibrary,
    title: 'settings.page.nav.library',
    icon: 'mdi-book-multiple-outline',
  },
  {
    name: ROUTE.settingsAppearance,
    title: 'settings.page.nav.appearance',
    icon: 'mdi-palette-outline',
  },
  {
    name: ROUTE.settingsExtensions,
    title: 'settings.page.nav.extensions',
    icon: 'mdi-puzzle-outline',
  },
  {
    name: ROUTE.settingsAbout,
    title: 'settings.page.nav.about',
    icon: 'mdi-information-outline',
  },
];

const { t } = useI18n();
</script>

<template>
  <v-container max-width="900" class="pa-8">
    <PageHeader :title="t('settings.page.title')" />
    <v-tabs
      color="primary"
      show-arrows
      class="tabs mb-8"
      :aria-label="t('settings.page.navLabel')"
    >
      <v-tab
        v-for="section in SECTIONS"
        :key="section.name"
        :to="{ name: section.name }"
        :prepend-icon="section.icon"
        :text="t(section.title)"
      />
    </v-tabs>
    <router-view />
  </v-container>
</template>

<style scoped>
.tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
