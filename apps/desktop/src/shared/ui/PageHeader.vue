<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <header class="page-header mb-6">
    <div class="text">
      <h1 class="text-headline-large font-weight-bold">{{ title }}</h1>
      <p v-if="subtitle" class="text-body-large text-medium-emphasis mt-1">
        {{ subtitle }}
      </p>
      <slot />
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem 1.5rem;
}

.text {
  flex: 1 1 20rem;
  min-width: 0;
}

.actions {
  flex: 0 0 auto;
}
</style>
