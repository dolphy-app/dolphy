<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ExtensionDataUsageDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';
import { displayName } from '../lib/catalog.ts';
import { formatBytes } from '../lib/format.ts';
import { dataTotals, hasData } from '../model/extension-data.ts';

const props = defineProps<{
  extension: ExtensionInfoDto;
  /** `undefined` — использование ещё не прочитано. */
  usage: ExtensionDataUsageDto | undefined;
  clearing: boolean;
}>();

const emit = defineEmits<{ clear: [] }>();

const { t, locale } = useI18n();

// строка «Данные» показывается, только если у расширения есть данные
const totals = computed(() =>
  props.usage !== undefined && hasData(props.usage)
    ? dataTotals(props.usage)
    : null,
);
const confirming = ref(false);
const clearButton = ref<{ $el: HTMLElement } | null>(null);

// после закрытия диалога (в том числе по Esc) фокус возвращается на кнопку
watch(confirming, (open) => {
  if (!open) void nextTick(() => clearButton.value?.$el.focus());
});

const confirm = () => {
  confirming.value = false;
  emit('clear');
};
</script>

<template>
  <div
    v-if="totals !== null"
    class="d-flex flex-wrap align-center ga-2 mt-3"
    data-point="data"
    :data-testid="`data-${extension.id}`"
  >
    <span class="text-body-small text-medium-emphasis">
      {{ t('settings.extensions.data.title') }}:
    </span>
    <span class="text-body-small" data-testid="data-usage">
      {{
        t('settings.extensions.data.usage', {
          keys: t(
            'settings.extensions.data.keys',
            { n: totals.keys },
            totals.keys,
          ),
          size: formatBytes(totals.bytes, locale),
        })
      }}
    </span>
    <v-btn
      ref="clearButton"
      variant="text"
      size="small"
      prepend-icon="mdi-database-remove-outline"
      :loading="clearing"
      :aria-label="
        t('settings.extensions.data.clearLabel', {
          name: displayName(extension),
        })
      "
      :data-testid="`clear-${extension.id}`"
      @click="confirming = true"
    >
      {{ t('settings.extensions.data.clear') }}
    </v-btn>

    <v-dialog
      v-model="confirming"
      max-width="480"
      :aria-labelledby="`clear-title-${extension.id}`"
    >
      <v-card class="pa-2">
        <v-card-title :id="`clear-title-${extension.id}`" class="text-wrap">
          {{
            t('settings.extensions.data.confirmTitle', {
              name: displayName(extension),
            })
          }}
        </v-card-title>
        <v-card-text>{{
          t('settings.extensions.data.confirmText')
        }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirming = false">
            {{ t('settings.extensions.data.cancel') }}
          </v-btn>
          <v-btn
            variant="flat"
            color="error"
            data-testid="clear-confirm"
            @click="confirm"
          >
            {{ t('settings.extensions.data.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
