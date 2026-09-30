<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>();
</script>

<template>
  <header class="mb-6">
    <h2 class="text-title-large font-weight-bold">{{ title }}</h2>
    <p class="text-body-medium text-medium-emphasis mt-1">{{ subtitle }}</p>
  </header>
</template>
