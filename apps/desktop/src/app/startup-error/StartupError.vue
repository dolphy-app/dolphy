<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ kind: 'update' | 'failed'; message: string }>();

const { t } = useI18n();

const isUpdate = computed(() => props.kind === 'update');
const title = computed(() =>
  isUpdate.value ? t('startup.updateTitle') : t('startup.failedTitle'),
);
const text = computed(() =>
  isUpdate.value ? t('startup.updateText') : undefined,
);
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="d-flex justify-center pt-16">
        <v-empty-state
          icon="mdi-alert-circle-outline"
          :title="title"
          :text="text"
          max-width="40rem"
        >
          <code class="text-body-small">{{ message }}</code>
        </v-empty-state>
      </v-container>
    </v-main>
  </v-app>
</template>
