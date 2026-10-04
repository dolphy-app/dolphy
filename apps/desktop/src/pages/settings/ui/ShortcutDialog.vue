<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Platform, SpokenId } from '@dolphy-app/keybindings';
import { CAPTURE_ATTRIBUTE, describeChord } from '@/features/keybindings';
import { CONTEXT_KEY_NAMES } from '@/shared/lib/context-keys.ts';
import type { ShortcutEditor } from '../model/shortcut-editor.ts';

const props = defineProps<{ editor: ShortcutEditor; platform: Platform }>();

const { t } = useI18n();
// условие — ref редактора: он создаётся один раз на страницу
const { when } = props.editor;
const captureAttribute = { [CAPTURE_ATTRIBUTE]: '' };
const capture = ref<HTMLElement | null>(null);

const word = (id: SpokenId) => t(`keybinding.${id}`);
const OPERATORS = '! && || == !=';

const recorded = computed(() =>
  props.editor.strokes.value.length === 0
    ? null
    : describeChord(props.editor.strokes.value, props.platform, word),
);
const title = computed(() => {
  const target = props.editor.target.value;
  if (target === null) return '';
  return t(
    target.previous === null
      ? 'settings.shortcuts.dialog.titleAdd'
      : 'settings.shortcuts.dialog.titleEdit',
    { title: target.title },
  );
});

const problemText = computed(() => {
  const problem = props.editor.problem.value;
  if (problem === null) return null;
  if (problem.reason === 'duplicate') {
    return t('settings.shortcuts.problems.duplicate');
  }
  if (problem.reason === 'typing') {
    return t('settings.shortcuts.problems.typing');
  }
  const reason = t(`settings.shortcuts.problems.reason.${problem.detail}`);
  return problem.field === 'when'
    ? t('settings.shortcuts.problems.when', {
        position: problem.position + 1,
        reason,
      })
    : t('settings.shortcuts.problems.key', { reason });
});

const hasBlocking = computed(() =>
  props.editor.conflicts.value.some(({ blocking }) => blocking),
);

const failureText = computed(() => {
  const failure = props.editor.failure.value;
  if (failure === null) return null;
  return t(`settings.shortcuts.failed.${failure.reason}`, {
    field: failure.field ?? '',
    command: failure.command ?? '',
    other: failure.other ?? '',
    message: failure.message,
  });
});

// запись сочетания: события гасятся, чтобы браузер и окно не обработали их сами;
// Tab и одиночные модификаторы проходят, иначе фокус не выйти из области записи
const onKey = (event: KeyboardEvent) => {
  const result = props.editor.press(event);
  if (result === 'ignored') return;
  event.preventDefault();
  event.stopPropagation();
  if (result === 'cancel') props.editor.close();
};

const focusCapture = () => void nextTick(() => capture.value?.focus());

const save = async (reassign: boolean) => {
  if (await props.editor.save(reassign)) props.editor.close();
};
</script>

<template>
  <v-dialog
    :model-value="editor.target.value !== null"
    max-width="560"
    :aria-label="title"
    @update:model-value="(open: boolean) => !open && editor.close()"
    @after-enter="focusCapture"
  >
    <v-card v-if="editor.target.value !== null" data-testid="shortcut-dialog">
      <v-card-title class="text-title-large">{{ title }}</v-card-title>
      <v-card-text>
        <div
          id="shortcut-capture-label"
          class="text-body-medium font-weight-medium mb-1"
        >
          {{ t('settings.shortcuts.dialog.capture') }}
        </div>
        <div
          ref="capture"
          v-bind="captureAttribute"
          class="capture"
          tabindex="0"
          role="group"
          aria-labelledby="shortcut-capture-label"
          aria-describedby="shortcut-capture-help"
          data-testid="shortcut-capture"
          @keydown="onKey"
        >
          <template v-if="recorded">
            <kbd
              v-for="(stroke, index) in recorded.strokes"
              :key="index"
              class="keys"
              aria-hidden="true"
              >{{ stroke }}</kbd
            >
          </template>
          <span v-else class="text-medium-emphasis">{{
            t('settings.shortcuts.dialog.captureEmpty')
          }}</span>
        </div>
        <p
          id="shortcut-capture-help"
          class="text-body-small text-medium-emphasis mt-1"
        >
          {{ t('settings.shortcuts.dialog.captureHelp') }}
        </p>
        <div class="d-flex align-center ga-2 mt-1">
          <!-- запись озвучивается словами: подпись символами скринридер читает набором знаков -->
          <span class="text-body-small" role="status" aria-live="polite">
            <template v-if="recorded">{{
              t('settings.shortcuts.dialog.recorded', {
                keys: recorded.spoken,
              })
            }}</template>
          </span>
          <v-btn
            v-if="recorded"
            size="small"
            variant="text"
            @click="
              editor.clear();
              focusCapture();
            "
            >{{ t('settings.shortcuts.dialog.clear') }}</v-btn
          >
        </div>

        <v-text-field
          v-model="when"
          class="mt-4"
          variant="outlined"
          density="comfortable"
          autocomplete="off"
          spellcheck="false"
          persistent-hint
          :label="t('settings.shortcuts.dialog.when')"
          :hint="
            t('settings.shortcuts.dialog.whenHint', {
              keys: CONTEXT_KEY_NAMES.join(', '),
              operators: OPERATORS,
            })
          "
          :error-messages="
            editor.problem.value?.field === 'when' && problemText
              ? [problemText]
              : []
          "
          data-testid="shortcut-when"
        />
        <p
          v-if="problemText && editor.problem.value?.field !== 'when'"
          class="text-body-small mt-2 problem"
          role="alert"
        >
          {{ problemText }}
        </p>

        <div class="mt-4" aria-live="polite">
          <div class="text-body-medium font-weight-medium">
            {{ t('settings.shortcuts.dialog.conflictsTitle') }}
          </div>
          <ul
            v-if="editor.conflicts.value.length > 0"
            class="conflicts text-body-small"
            data-testid="shortcut-conflicts"
          >
            <li
              v-for="(conflict, index) in editor.conflicts.value"
              :key="index"
            >
              {{
                t(`settings.shortcuts.conflict.${conflict.kind}.wins`, {
                  other: conflict.otherTitle,
                  keys: conflict.otherKeys,
                })
              }}
              {{
                conflict.blocking
                  ? t('settings.shortcuts.dialog.blocking')
                  : t('settings.shortcuts.dialog.overrides')
              }}
            </li>
          </ul>
          <p v-else class="text-body-small text-medium-emphasis">
            {{ t('settings.shortcuts.dialog.noConflicts') }}
          </p>
        </div>

        <v-alert
          v-if="failureText"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          role="alert"
          data-testid="shortcut-failure"
          >{{ failureText }}</v-alert
        >
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="editor.close()">{{
          t('settings.shortcuts.dialog.cancel')
        }}</v-btn>
        <v-btn
          v-if="editor.conflicts.value.length > 0"
          variant="tonal"
          :disabled="!editor.canSave.value"
          data-testid="shortcut-reassign"
          @click="save(true)"
          >{{ t('settings.shortcuts.dialog.reassign') }}</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!editor.canSave.value || hasBlocking"
          :loading="editor.saving.value"
          data-testid="shortcut-save"
          @click="save(false)"
          >{{ t('settings.shortcuts.dialog.save') }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.capture {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px dashed rgba(var(--v-border-color), 0.6);
  border-radius: 8px;
}

.capture:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.conflicts {
  margin: 4px 0 0;
  padding-inline-start: 1.25rem;
}

.problem {
  color: rgb(var(--v-theme-error));
}

/* VHotkey: рамка и скругление клавиши */
.keys {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.75;
  white-space: nowrap;
}
</style>
