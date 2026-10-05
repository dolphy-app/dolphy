<script setup lang="ts">
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ start: []; skip: [] }>();

const { t } = useI18n();
const titleId = useId();
</script>

<template>
  <!-- закрытие (Escape, щелчок мимо) равно «Пропустить»: тур больше не навязывается -->
  <v-dialog
    :model-value="modelValue"
    max-width="460"
    :aria-labelledby="titleId"
    @update:model-value="(open: boolean) => !open && emit('skip')"
  >
    <v-card class="pa-6">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="48">
        <v-icon icon="mdi-map-marker-path" size="26" aria-hidden="true" />
      </v-avatar>
      <h2 :id="titleId" class="text-headline-small font-weight-bold mt-4">
        {{ t('tour.offer.title') }}
      </h2>
      <p class="text-body-large text-medium-emphasis mt-3">
        {{ t('tour.offer.text') }}
      </p>
      <div class="d-flex justify-end ga-2 mt-6">
        <v-btn variant="text" prepend-icon="mdi-close" @click="emit('skip')">
          {{ t('tour.offer.skip') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          append-icon="mdi-arrow-right"
          autofocus
          data-testid="tour-start"
          @click="emit('start')"
        >
          {{ t('tour.offer.start') }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
