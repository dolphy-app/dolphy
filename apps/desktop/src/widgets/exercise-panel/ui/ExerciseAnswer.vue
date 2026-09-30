<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Grade, VerdictDto } from '@lms/engine-contract';
import MarkdownView from '@/shared/ui/MarkdownView.vue';
import { describeVerdict } from '../lib/verdict.ts';
import SelfGrade from './SelfGrade.vue';

const props = withDefaults(
  defineProps<{
    /** Markdown условия. */
    prompt: string;
    /** Markdown эталонного ответа для самопроверки; `null` — его нет. */
    answer: string | null;
    /** Ответ проверяет раннер; иначе ученик ставит себе оценку. */
    verifiable: boolean;
    /** Что вводит ученик: `sql` для раннера SQL, иначе текст. */
    submissionKind: 'sql' | 'text';
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
  submit: [text: string];
  giveUp: [];
  reveal: [];
  selfGrade: [grade: Grade];
}>();

const { t } = useI18n();

// черновик живёт, пока смонтирована панель: у нового упражнения свой `key`
const draft = ref('');

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
const canSubmit = computed(() => draft.value.trim().length > 0);
const canGrade = computed(() => props.revealed || !props.answer);
const answerLabel = computed(() =>
  props.submissionKind === 'sql'
    ? t('exercisePanel.answer.sqlLabel')
    : t('exercisePanel.answer.label'),
);
const locked = computed(() => props.reviewed || props.busy);

const submitDraft = () => {
  if (canSubmit.value && !locked.value) emit('submit', draft.value);
};
</script>

<template>
  <div>
    <MarkdownView
      :source="prompt"
      class="text-title-large font-weight-medium"
    />

    <template v-if="verifiable">
      <v-textarea
        v-model="draft"
        class="answer mt-6"
        :label="answerLabel"
        auto-grow
        rows="4"
        spellcheck="false"
        :disabled="locked"
        :hint="t('exercisePanel.answer.hint')"
        persistent-hint
        @keydown.ctrl.enter.prevent="submitDraft"
        @keydown.meta.enter.prevent="submitDraft"
      />
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
          @click="submitDraft"
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
.answer :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
