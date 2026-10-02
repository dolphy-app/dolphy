<script setup lang="ts">
/** Значок расширения 32 px; без значка ничего не рисуется — вид прежний. */
defineProps<{ src: string | null }>();
</script>

<template>
  <img
    v-if="src !== null"
    :src="src"
    class="extension-icon"
    width="32"
    height="32"
    alt=""
    data-testid="extension-icon"
  />
</template>

<style scoped>
.extension-icon {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: contain;
}
</style>
