<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  title: string;
  subtitle: string;
  /** Доля заданных вопросов от бюджета, 0..100. */
  progress: number;
}>();

defineEmits<{ exit: [] }>();
const { t } = useI18n();
</script>

<template>
  <header class="top-bar px-4 py-3">
    <div class="d-flex align-center ga-3 title-block">
      <v-btn
        icon="mdi-close"
        variant="text"
        :aria-label="t('placement.topBar.exit')"
        @click="$emit('exit')"
      />
      <div class="text-truncate">
        <div class="text-title-medium font-weight-bold text-truncate">
          {{ title }}
        </div>
        <div class="overline-label text-truncate">{{ subtitle }}</div>
      </div>
    </div>
    <v-progress-linear
      class="progress"
      height="8"
      rounded
      color="primary"
      bg-color="surface-variant"
      bg-opacity="1"
      :model-value="progress"
      :aria-label="t('placement.topBar.progress')"
    />
  </header>
</template>

<style scoped>
.top-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(8rem, 26rem) minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
}

.title-block {
  min-width: 0;
}
</style>
