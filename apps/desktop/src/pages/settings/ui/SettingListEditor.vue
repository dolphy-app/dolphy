<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  label: string;
  items: readonly string[];
  maxItems: number;
  itemMaxLength: number;
  /** Подсказка и ошибки под редактором. */
  messages: readonly string[];
  hint: string;
  testId: string;
}>();

const emit = defineEmits<{
  /** Список изменён: добавление, удаление, перестановка или правка элемента. */
  change: [items: string[]];
}>();

const { t } = useI18n();

// элементы правятся черновиком и записываются по уходу из поля или Enter
const draft = ref<string[]>([...props.items]);
const editing = ref(false);
const added = ref('');
const list = ref<HTMLElement | null>(null);

watch(
  () => props.items,
  (items) => {
    if (!editing.value) draft.value = [...items];
  },
);

const full = computed(() => draft.value.length >= props.maxItems);

const apply = (next: string[]) => {
  draft.value = next;
  emit('change', [...next]);
};

const add = () => {
  const text = added.value.trim();
  if (text === '' || full.value) return;
  added.value = '';
  apply([...draft.value, text]);
};

const remove = (index: number) =>
  apply(draft.value.filter((_, at) => at !== index));

/** Меняет элемент местами с соседом и возвращает фокус на перенесённый элемент. */
const move = async (index: number, delta: -1 | 1) => {
  const target = index + delta;
  if (target < 0 || target >= draft.value.length) return;
  const next = [...draft.value];
  [next[index], next[target]] = [next[target], next[index]];
  apply(next);
  await nextTick();
  list.value
    ?.querySelectorAll<HTMLInputElement>('input[data-item]')
    [target]?.focus();
};

const commitItem = (index: number) => {
  editing.value = false;
  const text = draft.value[index]?.trim() ?? '';
  if (text === '') {
    remove(index);
    return;
  }
  const next = [...draft.value];
  next[index] = text;
  draft.value = next;
  const same =
    next.length === props.items.length &&
    next.every((item, at) => item === props.items[at]);
  if (!same) emit('change', [...next]);
};

const blurTarget = (event: Event) => {
  if (event.target instanceof HTMLElement) event.target.blur();
};

const onItemKey = (event: KeyboardEvent, index: number) => {
  if (!event.altKey) return;
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    void move(index, -1);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    void move(index, 1);
  }
};
</script>

<template>
  <div
    ref="list"
    class="setting-list"
    role="group"
    :aria-label="label"
    :data-testid="testId"
  >
    <div class="text-body-2 mb-1">{{ label }}</div>
    <ul class="list-reset">
      <li
        v-for="(_, index) in draft"
        :key="index"
        class="d-flex align-center ga-1 mb-1"
        data-testid="setting-list-item"
      >
        <v-text-field
          v-model="draft[index]"
          :aria-label="
            t('settings.extensions.settingsDialog.list.item', { n: index + 1 })
          "
          :maxlength="itemMaxLength"
          hide-details
          variant="outlined"
          density="compact"
          data-item
          @focus="editing = true"
          @blur="commitItem(index)"
          @keydown.enter="blurTarget"
          @keydown="onItemKey($event, index)"
        />
        <v-btn
          icon="mdi-arrow-up"
          size="small"
          variant="text"
          :disabled="index === 0"
          :aria-label="
            t('settings.extensions.settingsDialog.list.moveUp', {
              n: index + 1,
            })
          "
          data-testid="setting-list-up"
          @click="move(index, -1)"
        />
        <v-btn
          icon="mdi-arrow-down"
          size="small"
          variant="text"
          :disabled="index === draft.length - 1"
          :aria-label="
            t('settings.extensions.settingsDialog.list.moveDown', {
              n: index + 1,
            })
          "
          data-testid="setting-list-down"
          @click="move(index, 1)"
        />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          :aria-label="
            t('settings.extensions.settingsDialog.list.remove', {
              n: index + 1,
            })
          "
          data-testid="setting-list-remove"
          @click="remove(index)"
        />
      </li>
    </ul>
    <div class="d-flex align-center ga-1">
      <v-text-field
        v-model="added"
        :aria-label="t('settings.extensions.settingsDialog.list.newItem')"
        :placeholder="t('settings.extensions.settingsDialog.list.newItem')"
        :maxlength="itemMaxLength"
        :disabled="full"
        hide-details
        variant="outlined"
        density="compact"
        data-testid="setting-list-new"
        @keydown.enter.prevent="add"
      />
      <v-btn
        variant="tonal"
        size="small"
        :disabled="full || added.trim() === ''"
        data-testid="setting-list-add"
        @click="add"
      >
        {{ t('settings.extensions.settingsDialog.list.add') }}
      </v-btn>
    </div>
    <div class="text-caption text-medium-emphasis mt-1">
      {{
        t('settings.extensions.settingsDialog.list.count', {
          n: draft.length,
          max: maxItems,
        })
      }}
    </div>
    <div v-if="hint !== ''" class="text-caption text-medium-emphasis">
      {{ hint }}
    </div>
    <div
      v-for="message in messages"
      :key="message"
      class="text-caption text-error"
    >
      {{ message }}
    </div>
  </div>
</template>

<style scoped>
.list-reset {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
