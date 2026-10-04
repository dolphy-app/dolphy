<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import { ExerciseAnswer, ExerciseWorkspace } from '@/widgets/exercise-panel';
import { askedPercent } from '../lib/progress.ts';
import { createPlacement } from '../model/placement.ts';
import PlacementIntro from './PlacementIntro.vue';
import PlacementResult from './PlacementResult.vue';
import PlacementTopBar from './PlacementTopBar.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const course = route.query.course;
const courseId =
  typeof course === 'string' && course !== '' ? course : undefined;
const placement = createPlacement(useEngine(), { courseId });
const {
  stage,
  busy,
  error,
  intro,
  budget,
  progress,
  current,
  verdict,
  revealed,
  result,
  checked,
  passed,
  position,
} = placement;
void placement.init();
// страница закрыта без «Выйти»: сессия одна на профиль, оставлять её нельзя
onBeforeUnmount(() => void placement.abort());

const confirmExit = ref(false);

const probing = computed(() => stage.value === 'probing' && !!current.value);
const title = computed(() =>
  probing.value && current.value
    ? current.value.lessonName
    : t('placement.title'),
);
const subtitle = computed(() =>
  probing.value && progress.value
    ? t('placement.probe.counter', {
        n: position.value,
        budget: progress.value.budget,
      })
    : '',
);
const percent = computed(() =>
  progress.value
    ? askedPercent(progress.value.asked, progress.value.budget)
    : 0,
);
const unresolved = computed(() => progress.value?.unresolved ?? 0);
// «Осталось выяснить» показываем, только когда движок уже посчитал темы
const showUnresolved = computed(() => (progress.value?.asked ?? 0) > 0);
const confirmVariant = computed(() => (passed.value ? 'flat' : 'tonal'));

const toCourses = () => router.push({ name: ROUTE.courses });
const toPlan = () => router.push({ name: ROUTE.dailyPlan });
const openGraph = () =>
  router.push({
    name: ROUTE.courses,
    ...(courseId !== undefined && { query: { graph: courseId } }),
  });

/** Посреди теста выходим только с подтверждением: ответы не сохранятся. */
const exit = () => {
  if (stage.value === 'probing') confirmExit.value = true;
  else void toCourses();
};
const leave = async () => {
  confirmExit.value = false;
  await placement.abort();
  await toCourses();
};
</script>

<template>
  <v-main class="placement">
    <PlacementTopBar
      :title="title"
      :subtitle="subtitle"
      :progress="percent"
      @exit="exit"
    />
    <v-divider />

    <ExerciseWorkspace
      :material="probing ? (current?.material ?? null) : null"
      :course-name="current?.courseName ?? ''"
    >
      <v-progress-linear
        v-if="stage === 'loading' || busy"
        indeterminate
        rounded
      />

      <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
        {{ error }}
        <template v-if="stage === 'failed'" #append>
          <v-btn variant="text" @click="placement.retry()">{{
            t('common.retry')
          }}</v-btn>
        </template>
      </v-alert>

      <v-btn
        v-if="stage === 'failed'"
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        @click="toCourses"
      >
        {{ t('placement.backToCourses') }}
      </v-btn>

      <PlacementIntro
        v-else-if="stage === 'intro' && intro"
        v-model:budget="budget"
        :intro="intro"
        :busy="busy"
        @start="placement.begin()"
        @later="toCourses"
      />

      <PlacementResult
        v-else-if="stage === 'finished' && result"
        :result="result"
        @to-plan="toPlan"
        @open-graph="openGraph"
      />

      <template v-else-if="probing && current">
        <div class="d-flex flex-wrap align-center ga-3 mb-4">
          <v-chip
            size="small"
            variant="tonal"
            prepend-icon="mdi-book-open-variant-outline"
          >
            {{ current.lessonName }}
          </v-chip>
          <span
            v-if="showUnresolved"
            class="text-body-medium text-medium-emphasis"
          >
            {{ t('placement.probe.unresolved', { n: unresolved }, unresolved) }}
          </span>
        </div>

        <ExerciseAnswer
          :key="current.probeId"
          :prompt="current.prompt"
          :answer="current.answer"
          :verifiable="current.verifiable"
          :task="current.task"
          :view="current.view"
          :verdict="verdict"
          :revealed="revealed"
          :busy="busy"
          :reviewed="passed"
          :allow-give-up="false"
          @submit="(answer) => placement.submit(answer)"
          @reveal="placement.reveal()"
          @self-grade="(grade) => placement.selfGrade(grade)"
        />

        <p
          v-if="!current.verifiable"
          class="text-body-medium text-medium-emphasis mt-4"
        >
          {{ t('placement.probe.hint') }}
        </p>

        <div class="d-flex flex-wrap align-center ga-3 mt-8">
          <v-btn
            v-if="checked"
            color="primary"
            :variant="confirmVariant"
            size="large"
            append-icon="mdi-arrow-right"
            :loading="busy"
            @click="placement.confirm()"
          >
            {{ t('placement.probe.next') }}
          </v-btn>
          <v-btn variant="text" :disabled="busy" @click="placement.skip()">
            {{ t('placement.probe.skip') }}
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="busy"
            @click="placement.finishEarly()"
          >
            {{ t('placement.probe.finishEarly') }}
          </v-btn>
        </div>
      </template>
    </ExerciseWorkspace>

    <v-dialog v-model="confirmExit" max-width="400">
      <v-card class="pa-6">
        <h2 class="text-title-large font-weight-bold">
          {{ t('placement.exit.title') }}
        </h2>
        <p class="text-body-medium text-medium-emphasis mt-2">
          {{ t('placement.exit.text') }}
        </p>
        <div class="d-flex justify-end ga-2 mt-6">
          <v-btn variant="text" @click="confirmExit = false">
            {{ t('placement.exit.stay') }}
          </v-btn>
          <v-btn color="primary" variant="tonal" @click="leave">
            {{ t('placement.exit.leave') }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </v-main>
</template>

<style scoped>
.placement {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
</style>
