<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';
import { collectMarkdownBlocks } from '@/shared/lib/markdown-blocks.ts';
import type { MarkdownBlockSlot } from '@/shared/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '@/shared/lib/markdown.ts';
import MarkdownBlock from './MarkdownBlock.vue';

// корень — фрагмент: атрибуты родителя идут на сам документ
defineOptions({ inheritAttrs: false });

const props = defineProps<{ source: string }>();
const clients = useExtensionClients();
const root = useTemplateRef<HTMLElement>('root');

// на язык рендерер первого по id расширения
const renderers = computed(
  () =>
    new Map(
      clients.markdownRenderers.value
        .toReversed()
        .map((renderer) => [renderer.language, renderer]),
    ),
);
const render = computed(() =>
  createMarkdownRenderer(new Set(renderers.value.keys())),
);
const html = computed(() => render.value(props.source));

// Блоки рендереров рисуются компонентами расширений через `Teleport` в
// заглушки документа: общее дерево Vue (тема, язык, provide). Рендерер
// добавили, убрали, обновили или исправили (режим разработчика) — компонент
// блока сменяется сам, документ остаётся.
const blocks = shallowRef<MarkdownBlockSlot[]>([]);
const scan = () => {
  blocks.value = root.value === null ? [] : collectMarkdownBlocks(root.value);
};
onMounted(scan);
watch(html, scan, { flush: 'post' });
const placed = computed(() =>
  blocks.value.flatMap((block) => {
    const renderer = renderers.value.get(block.language);
    return renderer === undefined ? [] : [{ ...block, renderer }];
  }),
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it с html: false -->
  <div ref="root" v-bind="$attrs" class="markdown" v-html="html" />
  <MarkdownBlock
    v-for="(block, index) in placed"
    :key="index"
    :target="block.element"
    :renderer="block.renderer"
    :language="block.language"
    :source="block.source"
  />
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

.markdown :deep(li + li) {
  margin-top: 0.35em;
}

/* заголовки: глобальный сброс отступов оставляет их вплотную к тексту */
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  text-wrap: balance;
}

.markdown :deep(h1) {
  margin: 0 0 0.6em;
}

.markdown :deep(h2) {
  margin: 1.9em 0 0.55em;
}

.markdown :deep(h3),
.markdown :deep(h4) {
  margin: 1.5em 0 0.45em;
}

.markdown :deep(code),
.markdown :deep(pre) {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
}

.markdown :deep(code) {
  /* перенос внутри узкой колонки не рвёт рамку и фон на две полосы */
  box-decoration-break: clone;
  padding: 0.1em 0.35em;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 0.9em;
}

.markdown :deep(pre) {
  margin: 1em 0;
  padding: 1em;
  overflow-x: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-variant));
  tab-size: 2;
}

.markdown :deep(pre code) {
  padding: 0;
  border: 0;
  background: none;
}

/* подсветка кода: цвета `--sh-*` выводятся из темы и лежат на корне документа
   (syntax-binding.ts);
   остальные токены (имена, знаки, пробелы) красит сам блок */
.markdown :deep(.sh__token--keyword) {
  color: var(--sh-keyword);
}

.markdown :deep(.sh__token--string) {
  color: var(--sh-string);
}

.markdown :deep(.sh__token--class) {
  color: var(--sh-class);
}

.markdown :deep(.sh__token--property) {
  color: var(--sh-property);
}

.markdown :deep(.sh__token--entity) {
  color: var(--sh-entity);
}

.markdown :deep(.sh__token--comment) {
  color: var(--sh-comment);
  font-style: italic;
}

/* широкая таблица прокручивается сама, а не раздвигает колонку */
.markdown :deep(table) {
  display: block;
  max-width: 100%;
  margin: 1em 0;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 0.4em 0.75em;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  vertical-align: top;
}

.markdown :deep(th) {
  background: rgb(var(--v-theme-surface-variant));
  font-weight: 600;
  text-align: left;
}

.markdown :deep(tbody tr:nth-child(even) td) {
  background: rgba(var(--v-theme-surface-variant), 0.45);
}

.markdown :deep(hr) {
  margin: 1.75em 0;
  border: 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* выделенная врезка: цитата читается как примечание, а не как обычный абзац;
   `> [!WARNING]` и другие виды меняют только цвет акцента (`--callout`) */
.markdown :deep(blockquote) {
  --callout: var(--v-theme-primary);

  margin: 1em 0;
  padding: 0.35em 1em;
  border-left: 3px solid rgb(var(--callout));
  border-radius: 0 10px 10px 0;
  background: rgba(var(--callout), 0.07);
}

.markdown :deep(blockquote.callout--note) {
  --callout: var(--v-theme-info);
}

.markdown :deep(blockquote.callout--tip) {
  --callout: var(--v-theme-success);
}

.markdown :deep(blockquote.callout--important) {
  --callout: var(--v-theme-primary);
}

.markdown :deep(blockquote.callout--warning) {
  --callout: var(--v-theme-warning);
}

.markdown :deep(blockquote.callout--caution) {
  --callout: var(--v-theme-error);
}

.markdown :deep(blockquote > :first-child) {
  margin-top: 0;
}

.markdown :deep(blockquote > :last-child) {
  margin-bottom: 0;
}

.markdown :deep(.dolphy-md-block) {
  margin: 1em 0;
  overflow-x: auto;
}

.markdown :deep(.dolphy-md-block[data-state='done'] > pre) {
  display: none;
}

.markdown :deep(.dolphy-md-block[data-state='error']) {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  opacity: 0.8;
}

.markdown :deep(.dolphy-md-block pre) {
  margin: 0;
}

.markdown :deep(.dolphy-md-error) {
  margin: 0;
  padding: 0.5em 1em;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875em;
}
</style>
