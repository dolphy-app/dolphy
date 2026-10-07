<script setup lang="ts">
defineProps<{ count: number }>();
</script>

<template>
  <span class="note">{{ count }}</span>
</template>

<style scoped>
.note {
  font-weight: bold;
}
</style>
