<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { displayName } from '../lib/catalog.ts';
import { useExtensionSettings } from '../model/extension-settings.ts';
import { buildSettingsSections } from '../model/extension-settings-form.ts';
import ExtensionSettingField from './ExtensionSettingField.vue';

const props = defineProps<{ extension: ExtensionInfoDto }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const settings = useExtensionSettings(useEngine(), props.extension.id);
const { definitions, values, state, loadError, errors, resetting, resetError } =
  settings;
const sections = computed(() =>
  buildSettingsSections(definitions.value, values.value),
);
</script>

<template>
  <v-dialog
    :model-value="true"
    max-width="560"
    scrollable
    aria-labelledby="extension-settings-title"
    @update:model-value="emit('close')"
  >
    <v-card class="pa-2" data-testid="extension-settings">
      <v-card-title id="extension-settings-title" class="text-wrap">
        {{
          t('settings.extensions.settingsDialog.title', {
            name: displayName(extension),
          })
        }}
      </v-card-title>
      <v-card-text>
        <v-progress-linear
          v-if="state === 'loading'"
          indeterminate
          rounded
          :aria-label="
            t('settings.extensions.settingsDialog.title', {
              name: displayName(extension),
            })
          "
        />
        <v-alert v-if="state === 'failed'" type="error" variant="tonal">
          <div class="d-flex align-center ga-3">
            <span class="flex-grow-1">
              {{ t('settings.extensions.settingsDialog.loadFailed') }}:
              {{ loadError }}
            </span>
            <v-btn variant="text" @click="settings.load()">
              {{ t('settings.extensions.settingsDialog.retry') }}
            </v-btn>
          </div>
        </v-alert>
        <template v-if="state === 'loaded'">
          <section
            v-for="(section, index) in sections"
            :key="section.title ?? ''"
            :aria-labelledby="
              section.title === null ? undefined : `settings-group-${index}`
            "
            data-testid="settings-section"
          >
            <h3
              v-if="section.title !== null"
              :id="`settings-group-${index}`"
              class="group-title text-title-medium font-weight-bold"
            >
              {{ section.title }}
            </h3>
            <ExtensionSettingField
              v-for="definition in section.fields"
              :key="definition.id"
              :definition="definition"
              :value="values[definition.id]"
              :error="errors[definition.id] ?? null"
              @commit="
                (value, problem) => settings.set(definition.id, value, problem)
              "
            />
          </section>
        </template>
        <v-alert
          v-if="resetError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ t('settings.extensions.settingsDialog.resetFailed') }}:
          {{ resetError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn
          variant="text"
          :disabled="state !== 'loaded'"
          :loading="resetting"
          data-testid="settings-reset"
          @click="settings.reset()"
        >
          {{ t('settings.extensions.settingsDialog.reset') }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          data-testid="settings-close"
          @click="emit('close')"
        >
          {{ t('settings.extensions.settingsDialog.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* глобальный сброс полей у заголовков не слоёный и перебивает утилиты Vuetify */
.group-title {
  margin-block: 8px 16px;
}
</style>
