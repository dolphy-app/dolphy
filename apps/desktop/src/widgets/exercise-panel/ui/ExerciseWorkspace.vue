<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import MarkdownView from '@/shared/ui/MarkdownView.vue';

defineProps<{
  /** Markdown материала урока; `null` — панели материала нет. */
  material: string | null;
  courseName: string;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="workspace">
    <aside v-if="material" class="material" aria-labelledby="material-label">
      <p id="material-label" class="overline-label mb-5">
        {{ t('exercisePanel.material', { course: courseName }) }}
      </p>
      <MarkdownView :source="material" class="reading" />
    </aside>

    <div class="content">
      <div class="content-inner">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
}

.material {
  /* ~55 знаков в строке: 34% окна, но не уже 22 и не шире 30 rem */
  flex: 0 0 clamp(22rem, 34%, 30rem);
  padding: 1.75rem 1.75rem 3rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* чтение длинного текста: крупнее и свободнее, заголовки тише */
.reading {
  font-size: 0.9375rem;
  line-height: 1.65;
  letter-spacing: 0.01em;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}

.reading :deep(h1) {
  font-size: 1.375rem;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0;
}

.reading :deep(h2) {
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0;
}

.reading :deep(h3),
.reading :deep(h4) {
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

.reading :deep(pre) {
  padding: 0.85rem 1rem;
  border-radius: 10px;
  font-size: 0.8125rem;
  line-height: 1.55;
  letter-spacing: 0;

  /* в узкой колонке горизонтальная прокрутка прячет `// результат` в хвосте строки */
  overflow-x: visible;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reading :deep(code) {
  font-size: 0.85em;
  letter-spacing: 0;
}

.reading :deep(pre code) {
  font-size: inherit;
}

.content {
  flex: 1;
  overflow-y: auto;
}

.content-inner {
  max-width: 45rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}
</style>
