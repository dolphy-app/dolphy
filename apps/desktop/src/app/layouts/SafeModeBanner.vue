<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useEngine } from '@/shared/api/engine';
import { useSafeMode } from './safe-mode.ts';

const { t } = useI18n();
const { banner, disabling, failed, disable } = useSafeMode(useEngine());
</script>

<template>
  <v-system-bar
    v-if="banner !== null"
    app
    color="warning"
    :height="44"
    class="safe-mode-banner ga-3 px-4"
    role="status"
    data-testid="safe-mode-banner"
  >
    <v-icon icon="mdi-shield-alert-outline" size="small" aria-hidden="true" />
    <span class="text-body-medium message">
      {{ t(`safeMode.banner.${banner.kind}`) }}
      <span v-if="failed" class="font-weight-bold" role="alert">
        {{ t('safeMode.banner.failed') }}
      </span>
    </span>
    <v-spacer />
    <v-btn
      v-if="banner.canDisable"
      size="small"
      variant="flat"
      color="surface"
      :loading="disabling"
      data-testid="safe-mode-disable"
      @click="disable"
    >
      {{ t('safeMode.banner.disable') }}
    </v-btn>
  </v-system-bar>
</template>

<style scoped>
.safe-mode-banner {
  flex-wrap: nowrap;
}

.message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
