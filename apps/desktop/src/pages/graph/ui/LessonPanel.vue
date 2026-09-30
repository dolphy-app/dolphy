<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { STATUS_VIEW } from '../lib/view.ts';
import type { CourseView, GraphView, LessonView } from '../lib/view.ts';

const SCORE_MAX = 5;
const STUDIABLE = new Set(['ready', 'in-progress', 'mastered']);

const props = defineProps<{
  lesson: LessonView;
  course: CourseView | null;
  view: GraphView;
}>();
const emit = defineEmits<{ close: []; select: [id: string]; study: [] }>();

const { t, n } = useI18n();

const look = computed(() => STATUS_VIEW[props.lesson.status]);
const nameOf = (id: string) => props.view.lessons.get(id)?.name ?? id;
const scoreText = computed(() =>
  props.lesson.score === null
    ? t('graph.node.noScore')
    : t('graph.panel.scoreValue', {
        score: n(props.lesson.score, { maximumFractionDigits: 1 }),
      }),
);
const canStudy = computed(() => STUDIABLE.has(props.lesson.status));
const studyHint = computed(() => {
  if (canStudy.value) return null;
  return props.lesson.status === 'locked'
    ? t('graph.panel.studyLocked')
    : t('graph.panel.studyUnavailable');
});
</script>

<template>
  <v-card class="panel pa-5" role="region" :aria-label="t('graph.panel.label')">
    <div class="d-flex align-start justify-space-between ga-2">
      <div class="min-width-0">
        <div v-if="course" class="text-label-large text-medium-emphasis">
          {{ t('graph.panel.course') }}: {{ course.name }}
        </div>
        <h2 class="text-title-large font-weight-bold mt-1">
          {{ lesson.name }}
        </h2>
      </div>
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        :aria-label="t('graph.panel.close')"
        @click="emit('close')"
      />
    </div>

    <dl class="facts mt-4">
      <dt class="text-label-large text-medium-emphasis">
        {{ t('graph.panel.status') }}
      </dt>
      <dd class="d-flex align-center ga-2">
        <v-icon :icon="look.icon" :color="look.color" size="20" />
        {{ t(`graph.status.${lesson.status}`) }}
      </dd>
      <dt class="text-label-large text-medium-emphasis">
        {{ t('graph.panel.score') }}
      </dt>
      <dd>
        {{ scoreText }}
        <v-progress-linear
          class="mt-1"
          :model-value="(lesson.score ?? 0) * (100 / SCORE_MAX)"
          :color="look.color"
          height="4"
          rounded
          aria-hidden="true"
        />
      </dd>
      <dt class="text-label-large text-medium-emphasis">
        {{ t('graph.panel.attempts') }}
      </dt>
      <dd>
        {{
          t(
            'graph.panel.attemptsCount',
            { n: lesson.attempts },
            lesson.attempts,
          )
        }}
      </dd>
      <template v-if="lesson.due > 0">
        <dt class="text-label-large text-medium-emphasis">
          {{ t('graph.panel.due') }}
        </dt>
        <dd>{{ t('graph.node.due', { n: lesson.due }, lesson.due) }}</dd>
      </template>
    </dl>

    <section class="mt-4">
      <h3 class="text-title-small font-weight-bold">
        {{ t('graph.panel.prerequisites') }}
      </h3>
      <p
        v-if="lesson.prerequisites.length === 0"
        class="text-body-medium text-medium-emphasis mt-1"
      >
        {{ t('graph.panel.noPrerequisites') }}
      </p>
      <v-list v-else density="compact" class="pa-0 mt-1" bg-color="transparent">
        <v-list-item
          v-for="id in lesson.prerequisites"
          :key="id"
          :title="nameOf(id)"
          :subtitle="
            t(`graph.status.${view.lessons.get(id)?.status ?? 'ready'}`)
          "
          :aria-label="t('graph.panel.openLesson', { name: nameOf(id) })"
          rounded="lg"
          @click="emit('select', id)"
        >
          <template #prepend>
            <v-icon
              class="mr-3"
              size="20"
              :icon="STATUS_VIEW[view.lessons.get(id)?.status ?? 'ready'].icon"
              :color="
                STATUS_VIEW[view.lessons.get(id)?.status ?? 'ready'].color
              "
            />
          </template>
        </v-list-item>
      </v-list>
    </section>

    <section class="mt-4">
      <h3 class="text-title-small font-weight-bold">
        {{ t('graph.panel.encompasses') }}
      </h3>
      <p
        v-if="lesson.encompasses.length === 0"
        class="text-body-medium text-medium-emphasis mt-1"
      >
        {{ t('graph.panel.noEncompasses') }}
      </p>
      <v-list v-else density="compact" class="pa-0 mt-1" bg-color="transparent">
        <v-list-item
          v-for="covered in lesson.encompasses"
          :key="covered.id"
          :title="nameOf(covered.id)"
          :subtitle="
            t('graph.panel.covered', {
              weight: n(covered.weight, { style: 'percent' }),
            })
          "
          :aria-label="
            t('graph.panel.openLesson', { name: nameOf(covered.id) })
          "
          rounded="lg"
          @click="emit('select', covered.id)"
        />
      </v-list>
    </section>

    <v-btn
      class="mt-6 w-100"
      color="primary"
      variant="flat"
      prepend-icon="mdi-play"
      :disabled="!canStudy"
      @click="emit('study')"
    >
      {{ t('graph.panel.study') }}
    </v-btn>
    <p v-if="studyHint" class="text-body-small text-medium-emphasis mt-2">
      {{ studyHint }}
    </p>
  </v-card>
</template>

<style scoped>
.panel {
  overflow-y: auto;
}

.min-width-0 {
  min-width: 0;
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  align-items: start;
}

.facts dd {
  margin: 0;
}
</style>
