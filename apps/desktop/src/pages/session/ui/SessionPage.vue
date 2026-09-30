<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useEngine } from '@/shared/api/engine';
import { ITEM_REASON } from '@/shared/config/item-reason.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { ExerciseAnswer, ExerciseWorkspace } from '@/widgets/exercise-panel';
import { createSession } from '../model/session.ts';
import { formatElapsed, useStopwatch } from '../model/stopwatch.ts';
import SessionTopBar from './SessionTopBar.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const stopwatch = useStopwatch();

const seed = Number(route.query.seed);
const course = route.query.course;
const session = createSession(useEngine(), {
  seed: Number.isInteger(seed) ? seed : undefined,
  courseId: typeof course === 'string' && course !== '' ? course : undefined,
});
const {
  stage,
  busy,
  error,
  current,
  verdict,
  result,
  remediation,
  revealed,
  position,
  total,
  summary,
} = session;
void session.start();

const paused = ref(false);

watch(paused, (isPaused) => {
  stopwatch.running.value = !isPaused;
});
// сессия закончена — время больше не копится
watch(stage, (next) => {
  if (next === 'finished') stopwatch.running.value = false;
});

const progress = computed(() =>
  total.value ? (summary.value.count / total.value) * 100 : 0,
);
const subtitle = computed(() =>
  current.value
    ? `${t(`reason.${current.value.reason}`)} · ${position.value} / ${total.value}`
    : '',
);
const isLast = computed(() => position.value >= total.value);
const averageGrade = computed(() => summary.value.averageGrade.toFixed(1));
const title = computed(() => current.value?.lessonName ?? t('session.title'));
const nextLabel = computed(() =>
  isLast.value ? t('session.actions.finish') : t('session.actions.next'),
);
const gaveUp = computed(
  () => !!current.value?.verifiable && result.value?.grade === 1,
);
/** Ответ для самопроверки: у проверяемых упражнений его показывает вердикт. */
const selfAnswer = computed(() =>
  current.value?.verifiable ? null : (current.value?.answer ?? null),
);

const exit = () => void router.push({ name: ROUTE.dailyPlan });
</script>

<template>
  <v-main class="session">
    <SessionTopBar
      :title="title"
      :subtitle="subtitle"
      :progress="progress"
      :elapsed="stopwatch.formatted.value"
      @exit="exit"
      @pause="paused = true"
    />
    <v-divider />

    <ExerciseWorkspace
      :material="current?.material ?? null"
      :course-name="current?.courseName ?? ''"
    >
      <v-progress-linear v-if="stage === 'loading'" indeterminate rounded />

      <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
        {{ error }}
        <template v-if="stage === 'failed'" #append>
          <v-btn variant="text" @click="session.start()">{{
            t('common.retry')
          }}</v-btn>
        </template>
      </v-alert>

      <v-empty-state
        v-if="stage === 'empty'"
        icon="mdi-check-circle-outline"
        :title="t('session.empty.title')"
        :text="t('session.empty.text')"
      >
        <v-btn color="primary" variant="flat" @click="exit">
          {{ t('session.toPlan') }}
        </v-btn>
      </v-empty-state>

      <v-card v-else-if="stage === 'finished'" class="pa-8 text-center">
        <v-icon icon="mdi-check-circle-outline" size="56" class="mb-4" />
        <h1 class="text-headline-medium font-weight-bold">
          {{ t('session.finished.title') }}
        </h1>
        <dl class="d-flex justify-center ga-10 my-8">
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('session.finished.count') }}
            </dt>
            <dd class="text-display-small font-weight-bold">
              {{ summary.count }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('session.finished.passed') }}
            </dt>
            <dd class="text-display-small font-weight-bold">
              {{ summary.passed }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('session.finished.averageGrade') }}
            </dt>
            <dd class="text-display-small font-weight-bold">
              {{ averageGrade }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">{{ t('session.finished.time') }}</dt>
            <dd class="text-display-small font-weight-bold">
              {{ formatElapsed(stopwatch.elapsedMs.value) }}
            </dd>
          </div>
        </dl>
        <v-btn color="primary" variant="flat" size="large" @click="exit">
          {{ t('session.toPlan') }}
        </v-btn>
      </v-card>

      <template v-else-if="current">
        <v-chip
          size="small"
          variant="flat"
          :color="ITEM_REASON[current.reason].color"
          :prepend-icon="ITEM_REASON[current.reason].icon"
        >
          {{ t(`reason.${current.reason}`) }}
        </v-chip>
        <ExerciseAnswer
          :key="current.attemptId"
          class="mt-4"
          :prompt="current.prompt"
          :answer="current.answer"
          :verifiable="current.verifiable"
          :submission-kind="current.submissionKind"
          :verdict="verdict"
          :revealed="revealed"
          :busy="busy"
          :reviewed="stage === 'reviewed'"
          @submit="(text) => session.submit(text)"
          @give-up="session.giveUp()"
          @reveal="session.reveal()"
          @self-grade="(grade) => session.selfGrade(grade)"
        />

        <template v-if="stage === 'reviewed'">
          <v-alert
            v-if="gaveUp"
            type="info"
            variant="tonal"
            class="mt-4"
            :text="t('session.gaveUp')"
          />
          <v-card v-if="selfAnswer" class="pa-6 mt-8">
            <MarkdownView :source="selfAnswer" />
          </v-card>
          <v-alert
            v-if="remediation.length"
            type="info"
            variant="tonal"
            class="mt-4"
            :title="t('session.remediation.title')"
            :text="
              t('session.remediation.text', {
                lessons: remediation.join(', '),
              })
            "
          />
          <div class="d-flex align-center ga-4 mt-6">
            <v-btn
              color="primary"
              variant="flat"
              size="large"
              append-icon="mdi-arrow-right"
              :loading="busy"
              @click="session.next()"
            >
              {{ nextLabel }}
            </v-btn>
            <span v-if="result" class="text-body-medium text-medium-emphasis">
              {{ t('session.grade', { grade: result.grade }) }}
            </span>
          </div>
        </template>
      </template>
    </ExerciseWorkspace>

    <v-dialog v-model="paused" persistent max-width="360">
      <v-card class="pa-6 text-center">
        <v-icon icon="mdi-pause-circle-outline" size="48" class="mb-3" />
        <h2 class="text-title-large font-weight-bold">
          {{ t('session.pause.title') }}
        </h2>
        <p class="text-body-medium text-medium-emphasis mt-2">
          {{ t('session.pause.text') }}
        </p>
        <v-btn
          class="mt-6"
          color="primary"
          variant="flat"
          @click="paused = false"
        >
          {{ t('session.pause.resume') }}
        </v-btn>
      </v-card>
    </v-dialog>
  </v-main>
</template>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
</style>
