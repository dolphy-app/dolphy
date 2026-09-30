<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '@/shared/lib/markdown.ts';

const props = defineProps<{ source: string }>();
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it с html: false -->
  <div class="markdown" v-html="html" />
</template>

<style scoped>
.markdown > :deep(:first-child) {
  margin-top: 0;
}

.markdown > :deep(:last-child) {
  margin-bottom: 0;
}

.markdown :deep(p),
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0.75em 0;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 1.5em;
}

.markdown :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 0.9em;
}

.markdown :deep(pre) {
  margin: 1em 0;
  padding: 1em;
  overflow-x: auto;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-variant));
}

.markdown :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown :deep(table) {
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 0.35em 0.75em;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
