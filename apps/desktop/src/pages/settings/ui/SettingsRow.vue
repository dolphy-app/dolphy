<script setup lang="ts">
import HelpHint from '@/shared/ui/HelpHint.vue';

/** `hint` — пояснение для непонятных терминов: значок «?» рядом с названием. */
defineProps<{ title: string; description: string; hint?: string }>();
</script>

<template>
  <v-card class="row px-5 py-4">
    <div class="text">
      <div class="d-flex align-center ga-1">
        <div class="text-title-medium font-weight-bold">{{ title }}</div>
        <HelpHint v-if="hint" :text="hint" />
      </div>
      <div class="text-body-medium text-medium-emphasis">{{ description }}</div>
    </div>
    <div class="control">
      <slot />
    </div>
  </v-card>
</template>

<style scoped>
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.text {
  flex: 1 1 16rem;
  min-width: 0;
}

.control {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>
