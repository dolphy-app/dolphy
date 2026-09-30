<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ROUTE } from '@/shared/config/routes.ts';

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
    name: ROUTE.settingsAbout,
    title: 'settings.page.nav.about',
    icon: 'mdi-information-outline',
  },
];

const { t } = useI18n();
</script>

<template>
  <div class="settings">
    <aside class="nav pa-6">
      <h1 class="text-headline-small font-weight-bold px-3 mb-4">
        {{ t('settings.page.title') }}
      </h1>
      <v-list nav :aria-label="t('settings.page.navLabel')">
        <v-list-item
          v-for="section in SECTIONS"
          :key="section.name"
          :to="{ name: section.name }"
          :prepend-icon="section.icon"
          :title="t(section.title)"
          color="primary"
          rounded="lg"
        />
      </v-list>
    </aside>
    <div class="content">
      <div class="content-inner">
        <router-view />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  min-height: 100vh;
}

.nav {
  flex: 0 0 16rem;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.nav :deep(.v-list-item__spacer) {
  width: 12px;
}

.content {
  flex: 1;
  min-width: 0;
}

.content-inner {
  max-width: 48rem;
  padding: 2rem 2.5rem 4rem;
}
</style>
