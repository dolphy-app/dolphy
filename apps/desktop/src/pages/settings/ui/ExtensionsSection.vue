<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import CatalogExtensions from './CatalogExtensions.vue';
import InstalledExtensions from './InstalledExtensions.vue';
import SectionHeader from './SectionHeader.vue';

type ExtensionsTab = 'installed' | 'catalog';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// вкладка живёт в адресе: возврат со страницы расширения открывает ту же вкладку
const tab = computed<ExtensionsTab>({
  get: () => (route.query['tab'] === 'catalog' ? 'catalog' : 'installed'),
  set: (next) => {
    void router.replace({ query: next === 'catalog' ? { tab: next } : {} });
  },
});
</script>

<template>
  <section :aria-label="t('settings.extensions.title')">
    <SectionHeader
      :title="t('settings.extensions.title')"
      :subtitle="t('settings.extensions.subtitle')"
    />

    <v-tabs
      v-model="tab"
      color="primary"
      class="tabs mb-6"
      :aria-label="t('settings.extensions.tabs.label')"
    >
      <v-tab
        id="extensions-tab-installed"
        value="installed"
        :text="t('settings.extensions.tabs.installed')"
      />
      <v-tab
        id="extensions-tab-catalog"
        value="catalog"
        :text="t('settings.extensions.tabs.catalog')"
      />
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item
        value="installed"
        role="tabpanel"
        aria-labelledby="extensions-tab-installed"
      >
        <InstalledExtensions :active="tab === 'installed'" />
      </v-tabs-window-item>
      <v-tabs-window-item
        value="catalog"
        role="tabpanel"
        aria-labelledby="extensions-tab-catalog"
      >
        <CatalogExtensions />
      </v-tabs-window-item>
    </v-tabs-window>
  </section>
</template>

<style scoped>
.tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
