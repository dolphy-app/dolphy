<script setup lang="ts">
import type { Grade } from '@dolphy-app/engine-contract';
import { useI18n } from 'vue-i18n';

interface GradeOption {
  grade: Grade;
  color: string;
}

const OPTIONS: GradeOption[] = [
  { grade: 1, color: 'error' },
  { grade: 2, color: 'warning' },
  { grade: 3, color: 'info' },
  { grade: 4, color: 'primary' },
  { grade: 5, color: 'success' },
];

defineProps<{ disabled: boolean }>();
defineEmits<{ select: [grade: Grade] }>();
const { t } = useI18n();
</script>

<template>
  <section aria-labelledby="self-grade-title">
    <p id="self-grade-title" class="overline-label mb-3">
      {{ t('exercisePanel.selfGrade.title') }}
    </p>
    <div class="options">
      <v-btn
        v-for="option in OPTIONS"
        :key="option.grade"
        variant="tonal"
        :color="option.color"
        size="x-large"
        stacked
        :disabled="disabled"
        @click="$emit('select', option.grade)"
      >
        <span class="text-headline-small font-weight-bold">
          {{ option.grade }}
        </span>
        <span class="text-label-medium">{{
          t(`exercisePanel.selfGrade.options.${option.grade}`)
        }}</span>
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.options {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.options :deep(.v-btn) {
  height: auto;
  padding-block: 16px;
}
</style>
