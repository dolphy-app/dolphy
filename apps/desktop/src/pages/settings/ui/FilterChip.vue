<script setup lang="ts">
/**
 * Чип-переключатель фильтра: кнопка с `aria-pressed`. Enter и пробел обрабатывает
 * сам `v-chip` (он кликабелен из-за `@click`); своих `keydown` здесь нет:
 * иначе клавиша сработает дважды и вернёт прежнее состояние. Число показывается
 * отдельным текстом; чип без выбора с нулём нельзя нажать.
 */
const props = defineProps<{
  selected: boolean;
  label: string;
  count?: number;
}>();

const emit = defineEmits<{ toggle: [] }>();

const blocked = () => props.count === 0 && !props.selected;

const toggle = () => {
  if (!blocked()) emit('toggle');
};
</script>

<template>
  <v-chip
    role="button"
    :tabindex="blocked() ? -1 : 0"
    :aria-pressed="selected"
    :aria-disabled="blocked() ? 'true' : undefined"
    :disabled="blocked()"
    :variant="selected ? 'flat' : 'tonal'"
    :color="selected ? 'primary' : undefined"
    :prepend-icon="selected ? 'mdi-check' : undefined"
    @click="toggle"
  >
    {{ label }}
    <span
      v-if="count !== undefined"
      class="count"
      :class="{ 'text-medium-emphasis': !selected }"
      aria-hidden="true"
    >
      {{ count }}
    </span>
  </v-chip>
</template>

<style scoped>
.count {
  margin-inline-start: 0.375rem;
}
</style>
