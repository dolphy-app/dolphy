<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  title: string;
  subtitle: string;
  /** Доля пройденных упражнений, 0..100. */
  progress: number;
  elapsed: string;
  canUndo: boolean;
  canRedo: boolean;
}>();

defineEmits<{ exit: []; pause: []; undo: []; redo: [] }>();
const { t } = useI18n();
</script>

<template>
  <header class="top-bar px-4 py-3">
    <div class="d-flex align-center ga-3 title-block">
      <v-btn
        icon="mdi-close"
        variant="text"
        :aria-label="t('session.topBar.exit')"
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
      :aria-label="t('session.topBar.progress')"
    />
    <div class="d-flex align-center justify-end ga-4">
      <div class="text-right">
        <div class="overline-label">{{ t('session.topBar.time') }}</div>
        <div class="text-title-medium font-weight-bold tabular">
          {{ elapsed }}
        </div>
      </div>
      <div class="d-flex align-center">
        <v-btn
          icon="mdi-undo"
          variant="text"
          :disabled="!canUndo"
          :aria-label="t('session.topBar.undo')"
          @click="$emit('undo')"
        />
        <v-btn
          icon="mdi-redo"
          variant="text"
          :disabled="!canRedo"
          :aria-label="t('session.topBar.redo')"
          @click="$emit('redo')"
        />
      </div>
      <v-btn
        icon="mdi-pause"
        variant="tonal"
        color="primary"
        :aria-label="t('session.topBar.pause')"
        @click="$emit('pause')"
      />
    </div>
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

.tabular {
  font-variant-numeric: tabular-nums;
}
</style>
