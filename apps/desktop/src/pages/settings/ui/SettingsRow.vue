<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <v-card class="row px-5 py-4">
    <div class="text">
      <div class="text-title-medium font-weight-bold">{{ title }}</div>
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
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.text {
  flex: 1 1 0;
  min-width: 0;
}

.control {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>
