<script setup lang="ts">
import { computed, useId } from 'vue';
import { useTheme } from 'vuetify';

const props = defineProps<{
  /** Значение, которое сохраняется в настройках. */
  mode: string;
  /** Имена тем Vuetify для образца: `system` — светлая и тёмная. */
  themeNames: readonly string[];
  label: string;
  /** Подсказка (например, id расширения): `title` и описание радио; не переводится. */
  tooltip?: string;
  selected: boolean;
}>();
defineEmits<{ select: [mode: string] }>();

const themes = useTheme().themes;
const tooltipId = useId();

/** Образец берёт настоящие цвета тем: он не расходится с приложением. */
const palettes = computed(() =>
  props.themeNames.map((name) => {
    const colors: Record<string, unknown> = themes.value[name]?.colors ?? {};
    const css = (key: string) => String(colors[key] ?? '');
    return {
      '--p-bg': css('background'),
      '--p-surface': css('surface'),
      '--p-primary': css('primary'),
      '--p-text': css('on-surface'),
    };
  }),
);
</script>

<template>
  <label class="tile" :class="{ selected }" :title="tooltip">
    <input
      class="visually-hidden"
      type="radio"
      name="theme-mode"
      :value="mode"
      :checked="selected"
      :aria-describedby="tooltip ? tooltipId : undefined"
      @change="$emit('select', mode)"
    />
    <span class="preview" aria-hidden="true">
      <span
        v-for="(palette, index) in palettes"
        :key="index"
        class="layer"
        :class="{ split: palettes.length > 1 && index === 1 }"
        :style="palette"
      >
        <span class="side"><i /><i /><i /></span>
        <span class="main">
          <i class="heading" />
          <span class="panel"><i /><i class="short" /></span>
          <i class="action" />
        </span>
      </span>
    </span>
    <span class="caption">
      <span class="label">
        <span class="text-title-medium">{{ label }}</span>
        <span
          v-if="tooltip"
          :id="tooltipId"
          class="visually-hidden"
          aria-hidden="true"
        >
          {{ tooltip }}
        </span>
      </span>
      <v-icon
        v-if="selected"
        icon="mdi-check-circle"
        aria-hidden="true"
        color="primary"
        size="20"
      />
    </span>
  </label>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.tile:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.4);
}

.tile.selected {
  border: 2px solid rgb(var(--v-theme-primary));
  padding: calc(0.75rem - 1px);
}

.tile:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.preview {
  position: relative;
  display: block;
  height: 6rem;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.layer {
  position: absolute;
  inset: 0;
  display: flex;
  background: var(--p-bg);
}

/* «Как в системе»: вторая тема закрывает нижний правый угол по диагонали */
.layer.split {
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.side {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 28%;
  padding: 0.5rem;
  background: var(--p-surface);
}

.side i,
.panel i,
.heading {
  display: block;
  height: 0.25rem;
  border-radius: 2px;
  background: var(--p-text);
  opacity: 0.35;
}

.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem;
}

.heading {
  width: 55%;
  height: 0.375rem;
  opacity: 0.7;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.375rem;
  border-radius: 4px;
  background: var(--p-surface);
}

.short {
  width: 60%;
}

.action {
  width: 35%;
  height: 0.5rem;
  border-radius: 3px;
  background: var(--p-primary);
}

.label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
</style>
