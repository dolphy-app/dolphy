<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** Пометка «Устарело» у названия расширения; подробности — в `ExtensionDeprecation`. */
const { t } = useI18n();
</script>

<template>
  <v-chip
    size="small"
    label
    color="warning"
    variant="tonal"
    prepend-icon="mdi-alert-outline"
    data-testid="deprecated-chip"
  >
    {{ t('settings.extensions.deprecated.badge') }}
  </v-chip>
</template>
