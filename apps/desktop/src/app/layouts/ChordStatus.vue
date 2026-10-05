<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatChord, spokenChord } from '@dolphy-app/keybindings';
import type { Chord, SpokenId } from '@dolphy-app/keybindings';
import { useKeybindings } from '@/features/keybindings';

const props = defineProps<{ pending: Chord | null }>();

const { t } = useI18n();
const { platform } = useKeybindings();

const shown = computed(() =>
  props.pending === null
    ? ''
    : t('keybindings.pending', { keys: formatChord(props.pending, platform) }),
);
// `⌘K` скринридер читает набором символов: в живой области озвучивание словами
const announced = computed(() =>
  props.pending === null
    ? ''
    : t('keybindings.pending', {
        keys: spokenChord(props.pending, platform, (id: SpokenId) =>
          t(`keybinding.${id}`),
        ),
      }),
);
</script>

<template>
  <div>
    <div class="visually-hidden" role="status" aria-live="polite">
      {{ announced }}
    </div>
    <div
      v-if="pending !== null"
      class="chord-status"
      aria-hidden="true"
      data-testid="chord-pending"
    >
      {{ shown }}
    </div>
  </div>
</template>

<style scoped>
.chord-status {
  position: fixed;
  inset-block-end: 16px;
  inset-inline-start: 16px;
  z-index: 2500;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  font-size: 0.875rem;
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
