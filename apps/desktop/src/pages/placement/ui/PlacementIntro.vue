<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IntroInfo } from '../model/placement.ts';

const props = defineProps<{
  intro: IntroInfo;
  busy: boolean;
}>();
const budget = defineModel<number>('budget', { required: true });
defineEmits<{ start: []; later: [] }>();

const { t } = useI18n();
const course = computed(
  () => props.intro.courseName ?? t('placement.intro.allCourses'),
);
const canStart = computed(() => props.intro.lessonCount > 0);
</script>

<template>
  <v-empty-state
    v-if="!canStart"
    icon="mdi-bookshelf"
    :title="t('placement.intro.empty.title')"
    :text="t('placement.intro.empty.text')"
  >
    <v-btn variant="tonal" @click="$emit('later')">
      {{ t('placement.backToCourses') }}
    </v-btn>
  </v-empty-state>

  <v-card v-else class="pa-8">
    <v-icon icon="mdi-clipboard-check-outline" size="48" class="mb-4" />
    <h1 class="text-headline-medium font-weight-bold">
      {{ t('placement.intro.title') }}
    </h1>
    <p class="d-flex flex-wrap align-center ga-2 mt-4">
      <v-chip variant="tonal" prepend-icon="mdi-book-open-variant-outline">
        {{ course }}
      </v-chip>
      <v-chip variant="tonal" prepend-icon="mdi-format-list-numbered">
        {{
          t(
            'placement.intro.lessons',
            { n: intro.lessonCount },
            intro.lessonCount,
          )
        }}
      </v-chip>
    </p>
    <p class="text-body-large mt-6">{{ t('placement.intro.why') }}</p>
    <p class="text-body-medium text-medium-emphasis mt-3">
      {{ t('placement.intro.how') }}
    </p>

    <div class="mt-8">
      <div class="d-flex align-baseline justify-space-between ga-3">
        <label for="placement-budget" class="text-body-medium">
          {{ t('placement.intro.budget') }}
        </label>
        <span class="text-title-medium font-weight-bold">
          {{ t('placement.intro.questions', { n: budget }, budget) }}
        </span>
      </div>
      <v-slider
        id="placement-budget"
        v-model="budget"
        :min="1"
        :max="intro.maxBudget"
        :step="1"
        color="primary"
        hide-details
        :disabled="busy || intro.maxBudget <= 1"
      />
    </div>

    <div class="d-flex flex-wrap ga-3 mt-6">
      <v-btn
        color="primary"
        variant="flat"
        size="large"
        append-icon="mdi-arrow-right"
        :loading="busy"
        @click="$emit('start')"
      >
        {{ t('placement.intro.start') }}
      </v-btn>
      <v-btn
        variant="text"
        size="large"
        :disabled="busy"
        @click="$emit('later')"
      >
        {{ t('placement.intro.later') }}
      </v-btn>
    </div>
  </v-card>
</template>
