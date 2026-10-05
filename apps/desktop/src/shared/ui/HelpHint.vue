<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/** Значок «?» с пояснением: открывается наведением и фокусом, читается скринридером. */
defineProps<{ text: string }>();

const { t } = useI18n();
</script>

<template>
  <v-btn
    icon
    variant="text"
    size="x-small"
    density="comfortable"
    :aria-label="t('common.hint')"
  >
    <v-icon icon="mdi-help-circle-outline" size="18" aria-hidden="true" />
    <!-- у корня tooltip нужно имя (axe), и оно же даёт описание кнопке в закрытом состоянии -->
    <v-tooltip
      activator="parent"
      location="top"
      max-width="320"
      :aria-label="text"
    >
      {{ text }}
    </v-tooltip>
  </v-btn>
</template>
