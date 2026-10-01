<script setup lang="ts">
import { provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useContributions, useEngine } from '@/shared/api/engine';
import { INSTALL_KEY, useInstall } from '../model/install.ts';
import { useReloadRequired } from '../model/reload-required.ts';
import CatalogExtensions from './CatalogExtensions.vue';
import InstallDialog from './InstallDialog.vue';
import InstalledExtensions from './InstalledExtensions.vue';
import SectionHeader from './SectionHeader.vue';

type ExtensionsTab = 'installed' | 'catalog';

const { t } = useI18n();
const tab = ref<ExtensionsTab>('installed');

provide(INSTALL_KEY, useInstall(useEngine()));

const reloadRequired = useReloadRequired(useContributions());
const reloadWindow = () => {
  location.reload();
};
</script>

<template>
  <section :aria-label="t('settings.extensions.title')">
    <SectionHeader
      :title="t('settings.extensions.title')"
      :subtitle="t('settings.extensions.subtitle')"
    />

    <v-alert
      v-if="reloadRequired"
      type="info"
      variant="tonal"
      class="mb-6"
      data-testid="extensions-reload"
    >
      <div class="d-flex align-center ga-3">
        <span class="flex-grow-1">{{
          t('settings.extensions.reload.message')
        }}</span>
        <v-btn variant="text" prepend-icon="mdi-reload" @click="reloadWindow">
          {{ t('settings.extensions.reload.action') }}
        </v-btn>
      </div>
    </v-alert>

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

    <InstallDialog />
  </section>
</template>

<style scoped>
.tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
