<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  detectPlatform,
  displayKeybinding,
  spokenKeybinding,
} from '@/shared/lib/keybinding.ts';
import type { SpokenId } from '@/shared/lib/keybinding.ts';
import { useCommandPalette } from '../model/palette.ts';

const LIST_ID = 'command-palette-list';
const optionId = (index: number) => `command-palette-option-${index}`;

const { t } = useI18n();
const palette = useCommandPalette();
const platform = detectPlatform();
// `⌘K` скринридер читает набором символов: рядом с клавишей лежит озвучивание словами
const spoken = (keybinding: string) =>
  spokenKeybinding(keybinding, platform, (id: SpokenId) =>
    t(`keybinding.${id}`),
  );
const field = ref<{ focus(): void } | null>(null);
// палитра, открытая из поля ввода, забирает фокус себе: `autofocus` срабатывает только при монтировании
const focusField = () => field.value?.focus();

const entries = palette.entries;
const activeIndex = computed(() =>
  entries.value.findIndex((entry) => entry.key === palette.activeKey.value),
);
const activeOption = computed(() =>
  activeIndex.value < 0 ? undefined : optionId(activeIndex.value),
);
const isEmpty = computed(() => palette.query.value.trim() === '');

// группы по категориям, как subheader у VCommandPalette: без запроса список упорядочен по
// категории (без категории — последней группой), с запросом — по релевантности, и заголовки не нужны
const rows = computed(() =>
  entries.value.map((entry, index) => ({
    entry,
    index,
    heading:
      isEmpty.value &&
      entry.category &&
      entries.value[index - 1]?.category !== entry.category
        ? entry.category
        : null,
  })),
);

// фокус возвращается туда, откуда открыли палитру (в том числе в рамку панели)
let previous: HTMLElement | null = null;
watch(
  palette.isOpen,
  (open) => {
    if (open) previous = document.activeElement as HTMLElement | null;
  },
  { flush: 'sync' },
);
const restoreFocus = () => {
  const target = previous;
  previous = null;
  const active = document.activeElement;
  // фокус уже занят новым экраном (например, заголовком открытой панели) — не отбираем
  const lost = active === null || active === document.body;
  if (lost && target?.isConnected) target.focus();
};

const onInputKey = (event: KeyboardEvent) => {
  if (event.isComposing) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    palette.move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    void palette.choose();
  }
};

// выбранная строка остаётся в видимой части списка
watch(activeOption, async (id) => {
  await nextTick();
  if (id !== undefined)
    document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' });
});
// `role` у v-text-field попадает и на .v-field, и на input: вложенный combobox без aria-expanded
// нарушает ARIA, поэтому роль ставится только на input (остальные aria-* уже идут на него атрибутами)
const vComboboxInput = {
  mounted: (el: HTMLElement) =>
    el.querySelector('input')?.setAttribute('role', 'combobox'),
};
</script>

<template>
  <v-dialog
    :model-value="palette.isOpen.value"
    max-width="500"
    scrollable
    content-class="v-command-palette"
    :aria-label="t('commandPalette.title')"
    @update:model-value="
      (open: boolean) => (open ? palette.open() : palette.close())
    "
    @after-enter="focusField"
    @after-leave="restoreFocus"
  >
    <v-sheet class="palette" data-testid="command-palette">
      <div class="v-command-palette__input-container">
        <v-text-field
          ref="field"
          v-model="palette.query.value"
          v-combobox-input
          autofocus
          hide-details
          single-line
          flat
          autocomplete="off"
          variant="solo"
          bg-color="transparent"
          prepend-inner-icon="mdi-magnify"
          :aria-label="t('commandPalette.label')"
          :placeholder="t('commandPalette.placeholder')"
          aria-haspopup="listbox"
          aria-expanded="true"
          aria-autocomplete="list"
          :aria-controls="LIST_ID"
          :aria-activedescendant="activeOption"
          @keydown="onInputKey"
        />
        <span class="visually-hidden" aria-live="polite">
          {{ t('commandPalette.count', { n: entries.length }, entries.length) }}
        </span>
      </div>
      <v-divider />
      <!-- прокручиваемая область должна быть фокусируемой (axe scrollable-region-focusable); фокус остаётся в поле: см. mousedown у строк -->
      <div class="v-command-palette__content list-wrap" tabindex="-1">
        <ul
          :id="LIST_ID"
          role="listbox"
          class="options"
          :aria-label="t('commandPalette.list')"
        >
          <template v-for="row in rows" :key="row.entry.key">
            <li
              v-if="row.heading"
              class="subheader"
              role="presentation"
              aria-hidden="true"
            >
              {{ row.heading }}
            </li>
            <li
              :id="optionId(row.index)"
              role="option"
              class="option"
              :class="{
                active: row.entry.key === palette.activeKey.value,
                busy: palette.isBusy(row.entry.key),
              }"
              :aria-selected="row.entry.key === palette.activeKey.value"
              :aria-checked="row.entry.checked"
              :aria-disabled="palette.isBusy(row.entry.key)"
              @mousedown.prevent
              @mousemove="palette.activate(row.entry.key)"
              @click="palette.choose(row.entry.key)"
            >
              <span class="main">
                <span class="title">{{ row.entry.title }}</span>
                <span v-if="row.entry.description" class="description">{{
                  row.entry.description
                }}</span>
                <span v-if="row.entry.caption" class="caption">{{
                  row.entry.caption
                }}</span>
              </span>
              <span class="meta">
                <v-progress-circular
                  v-if="palette.isBusy(row.entry.key)"
                  indeterminate
                  size="16"
                  width="2"
                  aria-hidden="true"
                />
                <span
                  v-if="palette.isBusy(row.entry.key)"
                  class="visually-hidden"
                  >{{ t('commandPalette.busy') }}</span
                >
                <span
                  v-if="row.entry.category"
                  class="category"
                  :class="{ 'visually-hidden': isEmpty }"
                  >{{ row.entry.category }}</span
                >
                <template v-if="row.entry.checked">
                  <v-icon
                    icon="mdi-check"
                    size="small"
                    class="checked-mark"
                    aria-hidden="true"
                  />
                  <span class="visually-hidden">{{
                    t('commandPalette.checked')
                  }}</span>
                </template>
                <template v-if="row.entry.keybinding">
                  <kbd class="keybinding" aria-hidden="true">{{
                    displayKeybinding(row.entry.keybinding, platform)
                  }}</kbd>
                  <span class="visually-hidden">{{
                    spoken(row.entry.keybinding)
                  }}</span>
                </template>
              </span>
            </li>
          </template>
        </ul>
        <div v-if="entries.length === 0" class="v-command-palette__no-data">
          <div class="no-data-title">
            {{
              isEmpty
                ? t('commandPalette.empty')
                : t('commandPalette.noMatches')
            }}
          </div>
          <div>
            {{
              isEmpty
                ? t('commandPalette.emptyHint')
                : t('commandPalette.noMatchesHint')
            }}
          </div>
        </div>
      </div>
    </v-sheet>
  </v-dialog>
</template>

<style scoped>
/*
 * Вид повторяет VCommandPalette из Vuetify 4.2.2 (labs), MIT, © Vuetify:
 * node_modules/vuetify/lib/labs/VCommandPalette/VCommandPalette.scss и _variables.scss
 * https://github.com/vuetifyjs/vuetify/tree/master/packages/vuetify/src/labs/VCommandPalette
 * Свой компонент нужен ради ARIA (combobox, listbox, aria-activedescendant на поле ввода,
 * число результатов): VCommandPalette этого не даёт (ADR 0008).
 */
.palette {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  max-height: min(70vh, 32rem);
  overflow: hidden;
}

.v-command-palette__input-container {
  flex: none;
  padding: 8px 16px;
}

.v-command-palette__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* у Vuetify opacity 0.6: на светлой теме контраст 4.29:1 (axe color-contrast), берём 0.7 */
.v-command-palette__no-data {
  padding: 16px;
  text-align: center;
  opacity: 0.7;
}

.no-data-title {
  font-size: 1rem;
  font-weight: 500;
}

.options {
  margin: 0;
  padding: 8px 0;
  list-style: none;
}

/* .v-list-subheader: opacity 0.7, user-select none */
.subheader {
  padding: 0 16px;
  min-height: 40px;
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 400;
  opacity: 0.7;
  user-select: none;
  overflow-wrap: anywhere;
}

/* .v-list-item: два-три ряда текста, подсветка активной строки (--v-activated-opacity) */
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 8px 16px;
  cursor: pointer;
}

.option.active {
  background: rgba(var(--v-theme-on-surface), var(--v-activated-opacity));
}

.option.busy {
  cursor: progress;
  opacity: 0.6;
}

.main {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
}

/* названия и описания — данные расширения: длинное слово переносится */
.title,
.description,
.caption {
  overflow-wrap: anywhere;
}

.title {
  font-size: 1rem;
  line-height: 1.5rem;
}

.description,
.caption {
  font-size: 0.875rem;
  line-height: 1.25rem;
  opacity: var(--v-medium-emphasis-opacity);
}

.meta {
  display: flex;
  align-items: center;
  flex: none;
  min-width: 0;
  max-width: 50%;
  gap: 8px;
}

.category {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  opacity: var(--v-medium-emphasis-opacity);
}

.checked-mark {
  flex: none;
}

/* VHotkey: рамка и скругление клавиши */
.keybinding {
  flex: none;
  padding: 0 6px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: nowrap;
  opacity: var(--v-medium-emphasis-opacity);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

<!-- содержимое диалога вне компонента: верх палитры на 15vh, как у VCommandPalette (offsetTop) -->
<style>
.v-dialog > .v-overlay__content.v-command-palette {
  align-self: flex-start;
  margin: 15vh 0 0;
}
</style>
