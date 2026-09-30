<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { CourseSummary } from '@/entities/course';

defineProps<{ courses: Pick<CourseSummary, 'id' | 'name' | 'due'>[] }>();
const emit = defineEmits<{ select: [courseId: string] }>();

const { t } = useI18n();
</script>

<template>
  <div>
    <p class="text-label-large text-medium-emphasis mb-2">
      {{ t('courseScope.otherDue') }}
    </p>
    <div class="d-flex flex-wrap ga-2">
      <!-- цвет только у значка: цветной текст чипа не проходит контраст -->
      <v-chip
        v-for="course in courses"
        :key="course.id"
        variant="outlined"
        @click="emit('select', course.id)"
      >
        <template #prepend>
          <v-icon
            icon="mdi-history"
            color="warning"
            size="small"
            class="mr-2"
          />
        </template>
        {{ course.name }} · {{ course.due }}
      </v-chip>
    </div>
  </div>
</template>
