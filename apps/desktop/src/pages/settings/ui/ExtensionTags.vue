<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ExtensionTag } from '../lib/tags.ts';

/** Теги расширения компактными чипами; только показ, без действий. */
defineProps<{ tags: readonly ExtensionTag[] }>();

const { t } = useI18n();
</script>

<template>
  <ul
    v-if="tags.length > 0"
    class="tags mt-2"
    :aria-label="t('settings.extensions.tagsLabel')"
    data-point="tags"
  >
    <li v-for="tag in tags" :key="tag" :data-tag="tag">
      <v-chip size="x-small" variant="outlined" label>
        {{ t(`settings.extensions.tags.${tag}`) }}
      </v-chip>
    </li>
  </ul>
</template>

<style scoped>
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  list-style: none;
  padding: 0;
}
</style>
