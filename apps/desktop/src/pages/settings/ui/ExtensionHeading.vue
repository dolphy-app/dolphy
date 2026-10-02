<script setup lang="ts">
import ExtensionIcon from './ExtensionIcon.vue';

/**
 * Значок и название расширения одной группой. В строке с переносом группа
 * уходит на новую строку целиком: длинное название переносится рядом со
 * значком, а не оставляет его одного над собой.
 */
defineProps<{ icon: string | null }>();
</script>

<template>
  <div class="heading">
    <ExtensionIcon :src="icon" />
    <slot />
  </div>
</template>

<style scoped>
.heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
</style>
