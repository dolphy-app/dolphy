<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { updatesBadgeText, useExtensionUpdates } from '@/shared/api/engine';
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
    name: ROUTE.settingsShortcuts,
    title: 'settings.page.nav.shortcuts',
    icon: 'mdi-keyboard-outline',
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
const extensionUpdates = useExtensionUpdates();

/** Значок на вкладке «Расширения»: сколько расширений можно обновить. */
const updatesBadge = computed(() =>
  updatesBadgeText(extensionUpdates.count.value),
);
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
        :aria-describedby="
          section.name === ROUTE.settingsExtensions && updatesBadge
            ? 'tab-updates-hint'
            : undefined
        "
      >
        {{ t(section.title) }}
        <!-- число читает скринридер через описание вкладки, значок для него скрыт -->
        <span
          v-if="section.name === ROUTE.settingsExtensions && updatesBadge"
          aria-hidden="true"
          class="ms-2"
          data-testid="updates-badge-tab"
        >
          <v-badge inline color="primary" :content="updatesBadge" />
        </span>
      </v-tab>
    </v-tabs>
    <span
      v-if="updatesBadge"
      id="tab-updates-hint"
      class="visually-hidden"
      data-testid="updates-hint-tab"
      >{{
        t('common.extensionUpdates', { n: extensionUpdates.count.value })
      }}</span
    >
    <router-view />
  </v-container>
</template>

<style scoped>
.tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
