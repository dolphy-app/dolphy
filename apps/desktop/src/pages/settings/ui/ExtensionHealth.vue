<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ExtensionHealthDto } from '@dolphy-app/engine-contract';
import { hasHealthIssue } from '../model/extensions.ts';

/** `undefined` — здоровье ещё не прочитано; без сбоев и приостановки блока нет. */
defineProps<{ health: ExtensionHealthDto | undefined }>();

const { t, te, d } = useI18n();

/** Известная причина — переводом; незнакомая показывается как есть. */
const reasonText = (reason: string): string =>
  te(`settings.extensions.health.reason.${reason}`)
    ? t(`settings.extensions.health.reason.${reason}`)
    : reason;
</script>

<template>
  <div
    v-if="health !== undefined && hasHealthIssue(health)"
    class="text-body-medium mt-2"
    data-testid="extension-health"
    :data-failures="health.failures"
  >
    <p v-if="health.failures > 0" data-testid="health-failures">
      {{
        t(
          'settings.extensions.health.failures',
          { n: health.failures },
          health.failures,
        )
      }}
    </p>
    <p
      v-if="health.lastFailure !== null"
      class="text-body-small text-medium-emphasis"
      data-testid="health-last"
    >
      {{
        t('settings.extensions.health.last', {
          time: d(health.lastFailure.at, 'shortTime'),
          reason: reasonText(health.lastFailure.reason),
        })
      }}
      <span v-if="health.lastFailure.message !== ''" class="message">
        {{ health.lastFailure.message }}
      </span>
    </p>
    <p
      v-if="health.suppressedUntil !== null"
      class="text-warning"
      data-testid="health-suppressed"
    >
      {{
        t('settings.extensions.health.suppressed', {
          time: d(health.suppressedUntil, 'shortTime'),
        })
      }}
    </p>
  </div>
</template>

<style scoped>
.message {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
</style>
