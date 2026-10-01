<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UnitId } from '@dolphy-app/engine-contract';
import { useCourseScope } from '../model/use-course-scope.ts';

/** Значение чипа «Все курсы»: id курса пустым не бывает. */
const ALL = '';

const props = withDefaults(
  defineProps<{
    /** Чип «Все курсы»; `false` — экран работает с одним курсом. */
    allowAll?: boolean;
    /**
     * Курс, который показывается отмеченным, пока в настройках выбраны все
     * курсы (нужен при `allowAll: false`). Настройка при этом не меняется.
     */
    fallbackId?: UnitId | null;
  }>(),
  { allowAll: true, fallbackId: null },
);

const { t } = useI18n();
const scope = useCourseScope();

const selected = computed({
  get: () => scope.activeId.value ?? props.fallbackId ?? ALL,
  set: (id: string) => void scope.select(id === ALL ? null : id),
});
</script>

<template>
  <v-chip-group
    v-if="scope.courses.value.length > 1"
    v-model="selected"
    mandatory
    column
    color="primary"
    variant="tonal"
    filter
    :aria-label="t('courseScope.label')"
  >
    <v-chip v-if="allowAll" :value="ALL">
      {{ t('courseScope.all') }}
    </v-chip>
    <v-chip
      v-for="course in scope.courses.value"
      :key="course.id"
      :value="course.id"
    >
      {{ course.name }}
    </v-chip>
  </v-chip-group>
</template>
