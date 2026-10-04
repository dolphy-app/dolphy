<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { stripLeadingTitle } from '../lib/material.ts';

const props = defineProps<{
  /** Markdown материала урока. */
  material: string;
  courseName: string;
  /** Выбранная ширина, px; `null` — умолчание из CSS. */
  width: number | null;
}>();
const emit = defineEmits<{ collapse: [] }>();

const { t } = useI18n();
const source = computed(() => stripLeadingTitle(props.material));
const panel = useTemplateRef<HTMLElement>('panel');

const sections = ref<string[]>([]);
const current = ref(-1);
const progress = ref(0);
const menu = ref(false);

/** Отступ сверху, с которого раздел считается «текущим»: ниже липкой шапки. */
const SPY_OFFSET_PX = 96;

const headings = () =>
  Array.from(panel.value?.querySelectorAll<HTMLElement>('.markdown h2') ?? []);

const measure = () => {
  const element = panel.value;
  if (element === null) return;
  const max = element.scrollHeight - element.clientHeight;
  progress.value = max > 0 ? Math.min(1, element.scrollTop / max) : 0;
  const top = element.getBoundingClientRect().top;
  const atEnd = max > 0 && element.scrollTop >= max - 2;
  const found = headings().reduce(
    (index, heading, i) =>
      heading.getBoundingClientRect().top - top <= SPY_OFFSET_PX ? i : index,
    -1,
  );
  current.value = atEnd ? headings().length - 1 : found;
};

const collect = () => {
  const titles = headings().map((heading) => heading.textContent?.trim() ?? '');
  if (titles.join('\n') !== sections.value.join('\n')) sections.value = titles;
  measure();
};

const frame: { id: number | null } = { id: null };
const schedule = (run: () => void) => {
  if (frame.id !== null) return;
  frame.id = requestAnimationFrame(() => {
    frame.id = null;
    run();
  });
};

const goTo = (index: number) => {
  menu.value = false;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  headings()[index]?.scrollIntoView({
    block: 'start',
    behavior: reduce ? 'auto' : 'smooth',
  });
};

// новый материал — читать с начала; разметка пересобирается и сама по себе
// (рендерер добавили, блок дорисовался), поэтому разделы пересчитываются по DOM
const observer: { current: MutationObserver | null } = { current: null };
onMounted(() => {
  if (panel.value !== null) {
    observer.current = new MutationObserver(() => schedule(collect));
    observer.current.observe(panel.value, { childList: true, subtree: true });
  }
  collect();
});
watch(source, async () => {
  await nextTick();
  panel.value?.scrollTo({ top: 0 });
  collect();
});
onBeforeUnmount(() => {
  observer.current?.disconnect();
  if (frame.id !== null) cancelAnimationFrame(frame.id);
});
</script>

<template>
  <aside
    ref="panel"
    class="material"
    :style="width === null ? undefined : { flexBasis: `${width}px` }"
    aria-labelledby="material-label"
    @scroll.passive="schedule(measure)"
  >
    <header class="head">
      <div class="d-flex align-center ga-2 head-row">
        <p id="material-label" class="overline-label text-truncate flex-1-1">
          {{ t('exercisePanel.material', { course: courseName }) }}
        </p>
        <v-menu v-if="sections.length > 1" v-model="menu" location="bottom end">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              size="small"
              variant="text"
              icon="mdi-format-list-bulleted"
              :aria-label="t('exercisePanel.sections.button')"
              :title="t('exercisePanel.sections.button')"
            />
          </template>
          <v-list
            density="compact"
            :aria-label="t('exercisePanel.sections.label')"
          >
            <v-list-item
              v-for="(title, index) in sections"
              :key="index"
              :title="title"
              :active="index === current"
              @click="goTo(index)"
            />
          </v-list>
        </v-menu>
        <v-btn
          size="small"
          variant="text"
          icon="mdi-chevron-double-left"
          :aria-label="t('exercisePanel.panel.hide')"
          :title="t('exercisePanel.panel.hide')"
          @click="emit('collapse')"
        />
      </div>
      <div class="bar" aria-hidden="true">
        <div class="bar-fill" :style="{ transform: `scaleX(${progress})` }" />
      </div>
    </header>

    <div class="body">
      <MarkdownView :source="source" class="reading" />
    </div>
  </aside>
</template>

<style scoped>
.material {
  /* ~55 знаков в строке: 34% окна, но не уже 22 и не шире 30 rem */
  flex: 0 0 clamp(22rem, 34%, 30rem);
  max-width: 60%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* шапка не уезжает: видно, где ты, и можно перейти к разделу */
.head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding-top: 1rem;
  background: rgb(var(--v-theme-background));
}

.head-row {
  min-height: 2.25rem;
  padding: 0 0.75rem 0 1.75rem;
}

.bar {
  height: 2px;
  margin-top: 0.5rem;
  background: rgba(var(--v-border-color), var(--v-border-opacity));
}

.bar-fill {
  height: 100%;
  background: rgb(var(--v-theme-primary));
  transform-origin: left;
}

.body {
  padding: 1.25rem 1.75rem 3rem;
}

/* чтение длинного текста: крупнее и свободнее, заголовки тише */
.reading {
  font-size: 0.9375rem;
  line-height: 1.65;
  letter-spacing: 0.01em;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}

.reading :deep(h2),
.reading :deep(h3) {
  /* переход к разделу не прячет заголовок под липкой шапкой */
  scroll-margin-top: 4.5rem;
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

@media (prefers-reduced-motion: no-preference) {
  .bar-fill {
    transition: transform 120ms ease-out;
  }
}
</style>
