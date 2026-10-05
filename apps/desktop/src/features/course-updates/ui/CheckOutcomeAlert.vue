<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CheckOutcome } from '../lib/updates.ts';
import { useCourseUpdates } from '../model/use-course-updates.ts';

/** Сообщение живёт столько, чтобы его успели прочитать; закрывается и крестиком. */
const VISIBLE_MS = 8000;

const { t } = useI18n();
const store = useCourseUpdates();

const ICONS: Record<CheckOutcome['kind'], string> = {
  found: 'mdi-update',
  upToDate: 'mdi-check-circle-outline',
  unreachable: 'mdi-cloud-off-outline',
};
const COLORS: Record<CheckOutcome['kind'], string> = {
  found: 'warning',
  upToDate: 'success',
  unreachable: 'warning',
};

const text = computed(() => {
  const current = store.outcome.value;
  if (current === null) return '';
  if (current.kind === 'found') {
    return t('courseUpdates.check.found', { n: current.count }, current.count);
  }
  return t(`courseUpdates.check.${current.kind}`);
});

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => store.outcome.value,
  (current) => {
    clearTimeout(timer);
    if (current !== null) timer = setTimeout(store.clearOutcome, VISIBLE_MS);
  },
);
// уход с экрана: итог устарел, к возвращению его не показываем
onBeforeUnmount(() => {
  clearTimeout(timer);
  store.clearOutcome();
});
</script>

<template>
  <!-- тон и рамка — цвет итога, текст цвета темы: янтарный текст на светлом фоне ниже допустимого контраста -->
  <v-alert
    v-if="store.outcome.value !== null"
    variant="text"
    density="comfortable"
    closable
    :close-label="t('courseUpdates.notice.close')"
    :class="['tone-alert', `tone-${COLORS[store.outcome.value.kind]}`, 'mb-4']"
    role="status"
    data-testid="check-outcome"
    @click:close="store.clearOutcome"
  >
    <template #prepend>
      <v-icon
        :icon="ICONS[store.outcome.value.kind]"
        :color="COLORS[store.outcome.value.kind]"
        aria-hidden="true"
      />
    </template>
    {{ text }}
  </v-alert>
</template>

<style scoped>
.tone-alert.v-alert {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--tone), 0.14);
  border-inline-start: 4px solid rgb(var(--tone));
}

.tone-warning {
  --tone: var(--v-theme-warning);
}

.tone-success {
  --tone: var(--v-theme-success);
}
</style>
