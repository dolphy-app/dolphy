<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useContributions } from '@/shared/api/engine/contributions.ts';
import { hydrateMarkdownBlocks } from '@/shared/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '@/shared/lib/markdown.ts';

const props = defineProps<{ source: string }>();
const { t } = useI18n();
const contributions = useContributions();
const root = useTemplateRef<HTMLElement>('root');

const render = computed(() =>
  createMarkdownRenderer(
    new Set(contributions.markdownRenderers.map((r) => r.language)),
  ),
);
const html = computed(() => render.value(props.source));

const controller: { current: AbortController | null } = { current: null };

const hydrate = () => {
  controller.current?.abort();
  const element = root.value;
  if (element === null) return;
  const next = new AbortController();
  controller.current = next;
  void hydrateMarkdownBlocks({
    root: element,
    renderers: contributions.markdownRenderers,
    signal: next.signal,
    describeError: (language) => t('markdown.renderFailed', { language }),
    describeFrame: (language) => t('markdown.frameTitle', { language }),
  });
};

onMounted(hydrate);
watch(html, hydrate, { flush: 'post' });
onBeforeUnmount(() => controller.current?.abort());
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it с html: false -->
  <div ref="root" class="markdown" v-html="html" />
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
.markdown :deep(.spirula-md-block) {
  margin: 1em 0;
  overflow-x: auto;
}

.markdown :deep(.spirula-md-block[data-state='error']) {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  opacity: 0.8;
}

.markdown :deep(.spirula-md-block pre) {
  margin: 0;
}

.markdown :deep(.spirula-md-error) {
  margin: 0;
  padding: 0.5em 1em;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875em;
}
</style>
