<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CommandFailure } from '../lib/failure.ts';
import { useExtensionCommands } from '../model/extension-commands.ts';

const { t } = useI18n();
const { notices } = useExtensionCommands();

const FAILURE_KEYS = {
  changed: 'extensionCommands.notice.changed',
  timeout: 'extensionCommands.notice.timeout',
  activationTimeout: 'extensionCommands.notice.activationTimeout',
  hostDown: 'extensionCommands.notice.hostDown',
  invalidResult: 'extensionCommands.notice.invalidResult',
} as const;

const describeFailure = ({ kind, message }: CommandFailure): string => {
  if (kind === 'failed') {
    // текст расширения — данные: подставляется как есть
    return message === ''
      ? t('extensionCommands.notice.failed')
      : t('extensionCommands.notice.failedWith', { message });
  }
  return t(FAILURE_KEYS[kind]);
};

// текст расширения выводится как текст (интерполяция), не как разметка
const text = computed(() => {
  const entry = notices.current.value;
  if (entry === null) return '';
  return entry.notice.kind === 'notify'
    ? entry.notice.text
    : describeFailure(entry.notice.failure);
});
// цвет по виду уведомления `app.notify`; `info` и сбои команд — цвет по умолчанию
const color = computed(() => {
  const notice = notices.current.value?.notice;
  return notice?.kind === 'notify' && notice.level !== 'info'
    ? notice.level
    : undefined;
});

const open = computed({
  get: () => notices.current.value !== null,
  set: (value) => {
    const entry = notices.current.value;
    if (!value && entry !== null) notices.dismiss(entry.id);
  },
});
</script>

<template>
  <!-- ключ по идентификатору: новое уведомление с тем же текстом показывается заново -->
  <v-snackbar
    :key="notices.current.value?.id ?? 0"
    v-model="open"
    :color="color"
    timeout="6000"
    role="status"
    data-testid="extension-notice"
  >
    <span class="notice-text">{{ text }}</span>
    <template #actions>
      <v-btn variant="text" @click="open = false">
        {{ t('extensionCommands.notice.close') }}
      </v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
/* текст расширения — данные: длинное слово переносится и не выталкивает уведомление за окно */
.notice-text {
  display: block;
  overflow-wrap: anywhere;
}
</style>
