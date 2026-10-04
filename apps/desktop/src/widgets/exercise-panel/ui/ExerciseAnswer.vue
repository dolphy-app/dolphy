<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ExerciseTaskDto,
  Grade,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import type { AnswerChangeDetail } from '@dolphy-app/extension-api';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { splitPrompt } from '../lib/prompt.ts';
import { describeVerdict } from '../lib/verdict.ts';
import AnswerElement from './AnswerElement.vue';
import SelfGrade from './SelfGrade.vue';

const props = withDefaults(
  defineProps<{
    /** Markdown условия. */
    prompt: string;
    /** Markdown эталонного ответа для самопроверки; `null` — его нет. */
    answer: string | null;
    /** Ответ проверяет раннер; иначе ученик ставит себе оценку. */
    verifiable: boolean;
    /** Вид задания от расширения (элемент ввода ответа); `null` — нет. */
    task: ExerciseTaskDto | null;
    /** Публичный вид для элемента ответа (`project()` расширения). */
    view: unknown;
    verdict: VerdictDto | null;
    /** Ученик открыл эталонный ответ. */
    revealed: boolean;
    /** Идёт запрос: ввод и кнопки заблокированы. */
    busy: boolean;
    /** Ответ принят: ввод заблокирован, действий нет. */
    reviewed: boolean;
    /** Кнопка «Сдаться» у проверяемого упражнения. */
    allowGiveUp?: boolean;
  }>(),
  { allowGiveUp: true },
);
const emit = defineEmits<{
  submit: [answer: unknown];
  giveUp: [];
  reveal: [];
  selfGrade: [grade: Grade];
}>();

const { t } = useI18n();

// ответ живёт, пока смонтирована панель: у нового упражнения свой `key`
const answerState = ref<AnswerChangeDetail>({
  value: undefined,
  complete: false,
});

const parts = computed(() => splitPrompt(props.prompt));
const verdictView = computed(() =>
  props.verdict ? describeVerdict(props.verdict) : null,
);
const alertText = computed(() => {
  const view = verdictView.value;
  const reason = view?.reasonKey ? t(view.reasonKey) : null;
  if (view?.retryable) {
    return t('exercisePanel.verdict.errorRetry', { reason: reason ?? '' });
  }
  return view?.feedback ?? reason ?? undefined;
});
const canSubmit = computed(() => answerState.value.complete);
const canGrade = computed(() => props.revealed || !props.answer);
const locked = computed(() => props.reviewed || props.busy);

const submitAnswer = () => {
  if (canSubmit.value && !locked.value) emit('submit', answerState.value.value);
};
</script>

<template>
  <div>
    <MarkdownView
      v-if="parts.lead !== ''"
      :source="parts.lead"
      class="prompt prompt-lead"
      :class="
        parts.headline
          ? 'text-title-large font-weight-medium'
          : 'text-body-large'
      "
    />
    <MarkdownView
      v-if="parts.rest !== ''"
      :source="parts.rest"
      class="prompt text-body-large"
      :class="parts.lead !== '' ? 'mt-4' : ''"
    />

    <template v-if="verifiable">
      <AnswerElement
        v-if="task"
        class="mt-6"
        :task="task"
        :view="view"
        :disabled="locked"
        :verdict="verdict"
        :label="t('exercisePanel.answer.label')"
        @change="answerState = $event"
        @submit="submitAnswer"
      />
      <p class="text-body-small text-medium-emphasis mt-1">
        {{ t('exercisePanel.answer.hint') }}
      </p>
      <v-alert
        v-if="verdictView"
        :type="verdictView.type"
        :title="t(verdictView.titleKey)"
        :text="alertText"
        variant="tonal"
        class="mt-4"
      />
      <div v-if="!reviewed" class="d-flex ga-3 mt-6">
        <v-btn
          color="primary"
          variant="flat"
          size="large"
          :loading="busy"
          :disabled="!canSubmit"
          @click="submitAnswer"
        >
          {{ t('exercisePanel.actions.check') }}
        </v-btn>
        <v-btn
          v-if="allowGiveUp"
          variant="text"
          size="large"
          :disabled="busy"
          @click="emit('giveUp')"
        >
          {{ t('exercisePanel.actions.giveUp') }}
        </v-btn>
      </div>
    </template>

    <template v-else-if="!reviewed">
      <v-btn
        v-if="!canGrade"
        class="mt-8"
        color="primary"
        variant="flat"
        size="large"
        @click="emit('reveal')"
      >
        {{ t('exercisePanel.actions.reveal') }}
      </v-btn>
      <template v-else>
        <v-card v-if="answer" class="pa-6 mt-8">
          <p class="overline-label mb-3">
            {{ t('exercisePanel.answer.title') }}
          </p>
          <MarkdownView :source="answer" />
        </v-card>
        <div class="mt-8">
          <SelfGrade
            :disabled="busy"
            @select="(grade) => emit('selfGrade', grade)"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* длинная строка кода переносится: обрезанный хвост `// результат` важнее выравнивания */
.prompt :deep(pre) {
  overflow-x: visible;
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  /* продолжение строки сдвинуто вправо, чтобы не читаться как новая инструкция */
  padding-inline-start: calc(1em + 4ch);
  text-indent: -4ch each-line;
}
</style>
