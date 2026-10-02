<script setup lang="ts">
import { useExtensionIcon } from '../model/extension-icon.ts';

/**
 * Значок расширения 32 px; без значка или с нечитаемым значком ничего не
 * рисуется — вид прежний.
 */
const props = defineProps<{ src: string | null }>();
const { visible, markFailed } = useExtensionIcon(() => props.src);
</script>

<template>
  <img
    v-if="visible"
    :src="src ?? undefined"
    class="extension-icon"
    width="32"
    height="32"
    alt=""
    data-testid="extension-icon"
    @error="markFailed"
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
