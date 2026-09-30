<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ kind: 'update' | 'failed'; message: string }>();

const { t } = useI18n();
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="d-flex justify-center pt-16">
        <v-empty-state
          icon="mdi-alert-circle-outline"
          :title="
            kind === 'update'
              ? t('startup.updateTitle')
              : t('startup.failedTitle')
          "
          :text="kind === 'update' ? t('startup.updateText') : undefined"
          max-width="40rem"
        >
          <code class="text-body-small">{{ message }}</code>
        </v-empty-state>
      </v-container>
    </v-main>
  </v-app>
</template>
