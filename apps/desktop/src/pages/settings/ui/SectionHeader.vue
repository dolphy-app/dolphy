<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>();
</script>

<template>
  <header class="mb-6">
    <h2 class="text-headline-medium font-weight-bold">{{ title }}</h2>
    <p class="text-body-large text-medium-emphasis">{{ subtitle }}</p>
  </header>
</template>
