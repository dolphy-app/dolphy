<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useEngine } from '@/shared/api/engine';
import { createReadmeRenderer } from '../lib/readme.ts';

/**
 * Безопасный вывод README и журнала изменений: Markdown без сырого HTML, ссылки
 * `https:` во внешний браузер, остальные — текстом (`lib/readme.ts`). Картинки
 * приходят заглушками `<img data-src>`; окно запрашивает их у движка по одной
 * (`docImage`: файл этой версии, `png`/`webp`/`jpg`/`jpeg`, до 256 КиБ), а что не
 * получилось — заменяет текстом `alt`. Сетевых ресурсов страница не получает.
 */
const props = withDefaults(
  defineProps<{
    markdown: string;
    extensionId: string;
    /** Версия, из файлов которой берутся картинки. */
    version: string;
    /** Сдвиг заголовков README под заголовки страницы. */
    headingOffset?: number;
    /** `false` — журнал изменений: картинок нет. */
    images?: boolean;
  }>(),
  { headingOffset: 3, images: true },
);

const engine = useEngine();
const render = createReadmeRenderer();
const container = ref<HTMLElement | null>(null);

const html = computed(() =>
  render(props.markdown, {
    headingOffset: props.headingOffset,
    images: props.images,
  }),
);

const DATA_IMAGE = /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;

const showAlt = (image: HTMLImageElement) => {
  if (image.isConnected) image.replaceWith(document.createTextNode(image.alt));
};

const hydrateImage = async (image: HTMLImageElement) => {
  const path = image.dataset['src'] ?? '';
  image.addEventListener('error', () => showAlt(image), { once: true });
  try {
    const source = await engine.extensions.docImage(
      props.extensionId,
      props.version,
      path,
    );
    if (!image.isConnected) return;
    if (DATA_IMAGE.test(source)) image.src = source;
    else showAlt(image);
  } catch {
    showAlt(image);
  }
};

const hydrate = () => {
  const root = container.value;
  if (root === null) return;
  for (const image of root.querySelectorAll<HTMLImageElement>(
    'img[data-src]',
  )) {
    void hydrateImage(image);
  }
};

onMounted(hydrate);
// другая версия или расширение пересоздаёт блок (key), даже если текст README тот же
watch(
  [html, () => props.extensionId, () => props.version],
  () => void nextTick(hydrate),
);
</script>

<template>
  <div :key="`${extensionId}@${version}`" class="readme text-body-medium">
    <!-- eslint-disable vue/no-v-html -- markdown-it с html: false, ссылки только https, картинки через движок -->
    <div ref="container" data-testid="readme-body" v-html="html" />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<style scoped>
.readme {
  overflow-wrap: anywhere;
}

.readme :deep(h4),
.readme :deep(h5),
.readme :deep(h6) {
  margin: 1.25rem 0 0.5rem;
  font-weight: 700;
}

.readme :deep(h4) {
  font-size: 1.25rem;
}

.readme :deep(p),
.readme :deep(ul),
.readme :deep(ol),
.readme :deep(pre),
.readme :deep(blockquote),
.readme :deep(.readme-table) {
  margin: 0.5rem 0;
}

.readme :deep(ul),
.readme :deep(ol) {
  padding-inline-start: 1.5rem;
}

.readme :deep(a) {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}

.readme :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
}

.readme :deep(pre) {
  overflow-x: auto;
  padding: 0.75rem;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.readme :deep(blockquote) {
  padding-inline-start: 1rem;
  border-inline-start: 3px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.readme :deep(.readme-table) {
  overflow-x: auto;
}

.readme :deep(table) {
  border-collapse: collapse;
}

.readme :deep(th),
.readme :deep(td) {
  padding: 0.25rem 0.75rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.readme :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
