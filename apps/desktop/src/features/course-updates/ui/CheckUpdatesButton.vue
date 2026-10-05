<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CheckOutcome } from '../lib/updates.ts';
import { useCourseUpdates } from '../model/use-course-updates.ts';

const { t } = useI18n();
const store = useCourseUpdates();

const outcome = shallowRef<CheckOutcome | null>(null);
const open = computed({
  get: () => outcome.value !== null,
  set: (value: boolean) => {
    if (!value) outcome.value = null;
  },
});
const text = computed(() => {
  const current = outcome.value;
  if (current === null) return '';
  if (current.kind === 'found') {
    return t('courseUpdates.check.found', { n: current.count }, current.count);
  }
  return t(`courseUpdates.check.${current.kind}`);
});

const run = async () => {
  // проверка уже идёт (`null`): уведомление дождётся её итога у первого вызова
  const result = await store.check();
  if (result !== null) outcome.value = result;
};
</script>

<template>
  <template v-if="store.repositories.value.length > 0">
    <v-btn
      variant="text"
      prepend-icon="mdi-cloud-refresh-outline"
      :loading="store.checking.value"
      @click="run"
    >
      {{ t('courseUpdates.check.label') }}
    </v-btn>
    <v-snackbar v-model="open" timeout="6000" role="status">
      {{ text }}
    </v-snackbar>
  </template>
</template>
