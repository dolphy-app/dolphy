<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { LOG_LEVELS } from '@dolphy-app/engine-contract';
import type { LogLevelDto } from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { useExtensionLog } from '../model/extension-log.ts';

interface LevelView {
  icon: string;
  color: string | undefined;
}

// цвет дублируется иконкой и текстом уровня: цвет не единственный признак
const LEVEL_VIEW: Record<LogLevelDto, LevelView> = {
  debug: { icon: 'mdi-bug-outline', color: undefined },
  info: { icon: 'mdi-information-outline', color: 'info' },
  warn: { icon: 'mdi-alert-outline', color: 'warning' },
  error: { icon: 'mdi-alert-circle-outline', color: 'error' },
};

const props = defineProps<{
  /** Предустановленный фильтр; пусто — все записи. */
  presetExtensionId: string;
  /** Id расширений из списка: подсказки для фильтра (вводить можно любой id). */
  extensionIds: readonly string[];
}>();
const emit = defineEmits<{ close: [] }>();

const { t, d } = useI18n();
const log = useExtensionLog(useEngine(), props.presetExtensionId);
const { entries, state, error, busy, extensionId, minLevel } = log;

const scroller = ref<{ $el: HTMLElement } | null>(null);

// новые записи внизу: после каждого чтения показываем конец журнала
watch(
  entries,
  () => {
    void nextTick(() => {
      const element = scroller.value?.$el;
      if (element) element.scrollTop = element.scrollHeight;
    });
  },
  { flush: 'post' },
);

const timeOf = (at: number) =>
  d(at, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
</script>

<template>
  <v-dialog
    :model-value="true"
    max-width="960"
    scrollable
    aria-labelledby="extension-log-title"
    @update:model-value="emit('close')"
  >
    <v-card class="pa-2" data-testid="extension-log-dialog">
      <v-card-title id="extension-log-title" class="text-wrap">
        {{ t('settings.extensions.log.title') }}
      </v-card-title>

      <div class="filters px-4 pt-2">
        <v-combobox
          :model-value="extensionId"
          :items="extensionIds"
          :label="t('settings.extensions.log.filterExtension')"
          :hint="t('settings.extensions.log.filterExtensionHint')"
          persistent-hint
          clearable
          density="compact"
          variant="outlined"
          hide-no-data
          class="filter-extension"
          data-testid="extension-log-filter-extension"
          @update:model-value="log.setExtensionId($event ?? '')"
        />
        <v-select
          :model-value="minLevel"
          :items="
            LOG_LEVELS.map((level) => ({
              value: level,
              title: t(`settings.extensions.log.level.${level}`),
            }))
          "
          :label="t('settings.extensions.log.filterLevel')"
          density="compact"
          variant="outlined"
          class="filter-level"
          data-testid="extension-log-filter-level"
          @update:model-value="log.setMinLevel($event)"
        />
      </div>

      <v-card-text ref="scroller" class="pt-2">
        <v-progress-linear
          v-if="state === 'loading'"
          indeterminate
          rounded
          :aria-label="t('settings.extensions.log.title')"
        />

        <v-alert
          v-if="state === 'failed'"
          type="error"
          variant="tonal"
          data-testid="extension-log-error"
        >
          <div class="d-flex align-center ga-3">
            <span class="flex-grow-1 message">
              {{ t('settings.extensions.log.loadFailed') }}: {{ error }}
            </span>
            <v-btn variant="text" :loading="busy" @click="log.load()">
              {{ t('settings.extensions.log.retry') }}
            </v-btn>
          </div>
        </v-alert>

        <p
          v-if="state === 'loaded' && entries.length === 0"
          class="text-body-medium text-medium-emphasis"
          data-testid="extension-log-empty"
        >
          {{ t('settings.extensions.log.empty') }}
        </p>

        <ol
          v-if="entries.length > 0"
          class="entries"
          :aria-label="t('settings.extensions.log.listLabel')"
        >
          <li
            v-for="(entry, index) in entries"
            :key="`${entry.at}:${index}`"
            class="entry"
            :data-level="entry.level"
            data-testid="extension-log-entry"
          >
            <div class="d-flex flex-wrap align-center ga-2">
              <time
                class="time text-body-small text-medium-emphasis"
                :datetime="new Date(entry.at).toISOString()"
              >
                {{ timeOf(entry.at) }}
              </time>
              <v-chip
                size="x-small"
                label
                variant="tonal"
                :color="LEVEL_VIEW[entry.level].color"
                :prepend-icon="LEVEL_VIEW[entry.level].icon"
                data-testid="extension-log-level"
              >
                {{ t(`settings.extensions.log.level.${entry.level}`) }}
              </v-chip>
              <span class="mono text-body-small text-medium-emphasis">
                <span class="visually-hidden"
                  >{{ t('settings.extensions.log.sourceLabel') }}:
                </span>
                {{ entry.source }}
              </span>
              <v-chip
                v-if="entry.extensionId !== null"
                size="x-small"
                label
                class="mono"
                data-testid="extension-log-extension"
              >
                <span class="visually-hidden"
                  >{{ t('settings.extensions.log.extensionLabel') }}:
                </span>
                {{ entry.extensionId }}
              </v-chip>
            </div>
            <p class="mono message text-body-medium">{{ entry.message }}</p>
            <details v-if="entry.details !== null" class="details">
              <summary class="text-body-small text-medium-emphasis">
                {{ t('settings.extensions.log.details') }}
              </summary>
              <p class="mono message text-body-small text-medium-emphasis">
                {{ entry.details }}
              </p>
            </details>
          </li>
        </ol>
      </v-card-text>

      <v-card-actions>
        <span
          v-if="state === 'loaded'"
          class="text-body-small text-medium-emphasis ps-2"
          aria-live="polite"
        >
          {{
            t(
              'settings.extensions.log.count',
              { n: entries.length },
              entries.length,
            )
          }}
        </span>
        <v-spacer />
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-refresh"
          :loading="busy"
          data-testid="extension-log-refresh"
          @click="log.load()"
        >
          {{ t('settings.extensions.log.refresh') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          data-testid="extension-log-close"
          @click="emit('close')"
        >
          {{ t('settings.extensions.log.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.filter-extension {
  flex: 2 1 16rem;
}

.filter-level {
  flex: 1 1 11rem;
}

.entries {
  display: flex;
  flex-direction: column;
  list-style: none;
  padding: 0;
}

.entry {
  border-bottom: 1px solid rgb(var(--v-theme-on-surface), 0.12);
  padding: 0.5rem 0.25rem;
}

.entry:last-child {
  border-bottom: 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.message {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.time {
  font-variant-numeric: tabular-nums;
}

.details {
  margin-top: 0.25rem;
}

.details summary {
  cursor: pointer;
  width: fit-content;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
