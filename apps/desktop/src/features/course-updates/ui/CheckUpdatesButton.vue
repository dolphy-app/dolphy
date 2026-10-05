<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useCourseUpdates } from '../model/use-course-updates.ts';

const { t } = useI18n();
const store = useCourseUpdates();
</script>

<template>
  <v-btn
    v-if="store.repositories.value.length > 0"
    variant="text"
    prepend-icon="mdi-cloud-refresh-outline"
    :loading="store.checking.value"
    @click="store.check()"
  >
    {{ t('courseUpdates.check.label') }}
  </v-btn>
</template>
