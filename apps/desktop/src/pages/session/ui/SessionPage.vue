<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { AnswerChangeDetail } from '@lms/extension-api';
import { useEngine } from '@/shared/api/engine';
import { ITEM_REASON } from '@/shared/config/item-reason.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { describeVerdict } from '../lib/verdict.ts';
import { createSession } from '../model/session.ts';
import { formatElapsed, useStopwatch } from '../model/stopwatch.ts';
import ExerciseAnswer from './ExerciseAnswer.vue';
import MarkdownView from './MarkdownView.vue';
import SelfGrade from './SelfGrade.vue';
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

const NO_ANSWER: AnswerChangeDetail = { value: undefined, complete: false };
// shallowRef: ответ уходит в RPC (structured clone), реактивный Proxy не клонируется
const answer = shallowRef<AnswerChangeDetail>(NO_ANSWER);
const paused = ref(false);

watch(current, () => {
  answer.value = NO_ANSWER;
});
watch(paused, (isPaused) => {
  stopwatch.running.value = !isPaused;
});
// сессия закончена — время больше не копится
watch(stage, (next) => {
  if (next === 'finished') stopwatch.running.value = false;
});

const verdictView = computed(() =>
  verdict.value ? describeVerdict(verdict.value) : null,
);
const progress = computed(() =>
  total.value ? (summary.value.count / total.value) * 100 : 0,
);
const subtitle = computed(() =>
  current.value
    ? `${t(`reason.${current.value.reason}`)} · ${position.value} / ${total.value}`
    : '',
);
const verdictText = computed(() => {
  const view = verdictView.value;
  if (!view) return null;
  const reason = view.reasonKey ? t(view.reasonKey) : null;
  if (view.retryable) {
    return t('session.verdict.errorRetry', {
      reason: reason ?? view.reasonRaw ?? '',
    });
  }
  return view.feedback ?? reason ?? view.reasonRaw;
});
const alertText = computed(() => verdictText.value ?? undefined);
const canSubmit = computed(() => answer.value.complete);
const canGrade = computed(() => revealed.value || !current.value?.answer);
const isLast = computed(() => position.value >= total.value);
const averageGrade = computed(() => summary.value.averageGrade.toFixed(1));
const title = computed(() => current.value?.lessonName ?? t('session.title'));
const answerLocked = computed(() => stage.value === 'reviewed' || busy.value);
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

const submitAnswer = () => {
  if (canSubmit.value) void session.submit(answer.value.value);
};
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

    <div class="session-body">
      <aside v-if="current?.material" class="material pa-6">
        <p class="overline-label mb-4">
          {{ t('session.material', { course: current.courseName }) }}
        </p>
        <MarkdownView :source="current.material" class="text-body-medium" />
      </aside>

      <div class="content">
        <div class="content-inner">
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
            <MarkdownView
              :source="current.prompt"
              class="text-title-large font-weight-medium mt-4"
            />

            <template v-if="current.verifiable">
              <ExerciseAnswer
                v-if="current.task"
                :key="current.attemptId"
                class="mt-6"
                :task="current.task"
                :view="current.view"
                :disabled="answerLocked"
                :verdict="verdict"
                :label="t('session.answer.label')"
                @change="answer = $event"
                @submit="submitAnswer"
              />
              <p class="text-body-small text-medium-emphasis mt-1">
                {{ t('session.answer.hint') }}
              </p>
              <v-alert
                v-if="verdictView"
                :type="verdictView.type"
                :title="t(verdictView.titleKey)"
                :text="alertText"
                variant="tonal"
                class="mt-4"
              />
              <div v-if="stage === 'answering'" class="d-flex ga-3 mt-6">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="large"
                  :loading="busy"
                  :disabled="!canSubmit"
                  @click="submitAnswer"
                >
                  {{ t('session.actions.check') }}
                </v-btn>
                <v-btn
                  variant="text"
                  size="large"
                  :disabled="busy"
                  @click="session.giveUp()"
                >
                  {{ t('session.actions.giveUp') }}
                </v-btn>
              </div>
            </template>

            <template v-else-if="stage === 'answering'">
              <v-btn
                v-if="!canGrade"
                class="mt-8"
                color="primary"
                variant="flat"
                size="large"
                @click="session.reveal()"
              >
                {{ t('session.actions.reveal') }}
              </v-btn>
              <template v-else>
                <v-card v-if="current.answer" class="pa-6 mt-8">
                  <p class="overline-label mb-3">
                    {{ t('session.answer.title') }}
                  </p>
                  <MarkdownView :source="current.answer" />
                </v-card>
                <div class="mt-8">
                  <SelfGrade
                    :disabled="busy"
                    @select="(grade) => session.selfGrade(grade)"
                  />
                </div>
              </template>
            </template>

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
                <span
                  v-if="result"
                  class="text-body-medium text-medium-emphasis"
                >
                  {{ t('session.grade', { grade: result.grade }) }}
                </span>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>

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

.session-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.material {
  flex: 0 0 22rem;
  overflow-y: auto;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.content {
  flex: 1;
  overflow-y: auto;
}

.content-inner {
  max-width: 45rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
}
</style>
