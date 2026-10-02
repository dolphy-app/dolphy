<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  isPaletteShortcut,
  useExtensionCommands,
} from '@/features/extension-commands';

const LIST_ID = 'command-palette-list';
const optionId = (index: number) => `command-palette-option-${index}`;

const { t } = useI18n();
const { palette } = useExtensionCommands();

const entries = palette.entries;
const activeIndex = computed(() =>
  entries.value.findIndex((entry) => entry.key === palette.activeKey.value),
);
const activeOption = computed(() =>
  activeIndex.value < 0 ? undefined : optionId(activeIndex.value),
);
const isEmpty = computed(() => palette.query.value.trim() === '');

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

const onShortcut = (event: KeyboardEvent) => {
  if (!isPaletteShortcut(event)) return;
  event.preventDefault();
  palette.open();
};
onMounted(() => document.addEventListener('keydown', onShortcut, true));
onBeforeUnmount(() =>
  document.removeEventListener('keydown', onShortcut, true),
);

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
    max-width="640"
    scrollable
    content-class="command-palette-content"
    :aria-label="t('commandPalette.title')"
    @update:model-value="
      (open: boolean) => (open ? palette.open() : palette.close())
    "
    @after-leave="restoreFocus"
  >
    <v-card class="palette" data-testid="command-palette">
      <v-card-text class="search pb-2">
        <v-text-field
          v-combobox-input
          v-model="palette.query.value"
          autofocus
          hide-details
          autocomplete="off"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-magnify"
          :label="t('commandPalette.label')"
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
      </v-card-text>
      <v-divider />
      <v-card-text class="list-wrap pa-0">
        <ul
          :id="LIST_ID"
          role="listbox"
          class="options"
          :aria-label="t('commandPalette.list')"
        >
          <li
            v-for="(entry, index) in entries"
            :id="optionId(index)"
            :key="entry.key"
            role="option"
            class="option"
            :class="{
              active: entry.key === palette.activeKey.value,
              busy: palette.isBusy(entry.key),
            }"
            :aria-selected="entry.key === palette.activeKey.value"
            :aria-disabled="palette.isBusy(entry.key)"
            @mousemove="palette.activate(entry.key)"
            @click="palette.choose(entry.key)"
          >
            <span class="main">
              <span class="title">{{ entry.command.title }}</span>
              <span v-if="entry.command.description" class="description">{{
                entry.command.description
              }}</span>
              <span class="caption">{{ entry.command.extensionId }}</span>
            </span>
            <span class="meta">
              <v-progress-circular
                v-if="palette.isBusy(entry.key)"
                indeterminate
                size="16"
                width="2"
                aria-hidden="true"
              />
              <span v-if="palette.isBusy(entry.key)" class="visually-hidden">{{
                t('commandPalette.busy')
              }}</span>
              <v-chip v-if="entry.command.category" size="x-small" label>{{
                entry.command.category
              }}</v-chip>
              <span v-if="entry.command.keybinding" class="keybinding">{{
                entry.command.keybinding
              }}</span>
            </span>
          </li>
        </ul>
        <v-empty-state
          v-if="entries.length === 0"
          icon="mdi-console-line"
          :title="
            isEmpty ? t('commandPalette.empty') : t('commandPalette.noMatches')
          "
          :text="
            isEmpty
              ? t('commandPalette.emptyHint')
              : t('commandPalette.noMatchesHint')
          "
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.palette {
  max-height: min(70vh, 32rem);
}

/* поле поиска не сжимается и не прокручивается: прокручивается только список */
.search {
  flex: none;
}

.list-wrap {
  overflow-y: auto;
}

.options {
  margin: 0;
  padding: 0.25rem;
  list-style: none;
}

.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
}

.option.active {
  background: rgba(var(--v-theme-primary), 0.12);
}

.option.busy {
  cursor: progress;
  opacity: 0.6;
}

.main {
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  display: flex;
}

/* названия и описания — данные расширения: длинное слово переносится, а не раздвигает строку */
.title,
.description,
.caption {
  overflow-wrap: anywhere;
}

.title {
  font-weight: 500;
}

.description,
.caption {
  font-size: 0.8125rem;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* категория и подсказка клавиши не вытесняют название: не больше половины строки */
.meta {
  display: flex;
  align-items: center;
  flex: none;
  min-width: 0;
  max-width: 50%;
  gap: 0.5rem;
}

.meta :deep(.v-chip) {
  min-width: 0;
}

.meta :deep(.v-chip__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.keybinding {
  flex: none;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-on-surface-variant));
  white-space: nowrap;
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

<!-- содержимое диалога вне компонента: верх палитры фиксирован, список растёт вниз, поле поиска не прыгает -->
<style>
.v-dialog > .v-overlay__content.command-palette-content {
  align-self: flex-start;
  margin-top: 12vh;
}
</style>
