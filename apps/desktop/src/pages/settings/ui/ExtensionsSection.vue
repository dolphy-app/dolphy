<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ExtensionStateDto } from '@spirula/engine-contract';
import { useEngine } from '@/shared/api/engine';
import {
  contributionGroups,
  hasSwitches,
  isEnabled,
  isTrusted,
  useExtensions,
} from '../model/extensions.ts';
import SectionHeader from './SectionHeader.vue';

interface StateView {
  icon: string;
  color: string;
}

const STATE_VIEW: Record<ExtensionStateDto, StateView> = {
  loaded: { icon: 'mdi-check-circle-outline', color: 'success' },
  overridden: { icon: 'mdi-layers-outline', color: 'secondary' },
  invalid: { icon: 'mdi-alert-circle-outline', color: 'error' },
  disabled: { icon: 'mdi-pause-circle-outline', color: 'warning' },
};

const { t, te } = useI18n();
const {
  items,
  settings,
  state,
  error,
  busy,
  load,
  switching,
  switchError,
  needsReload,
  setEnabled,
  setTrusted,
} = useExtensions(useEngine());

const permissionLabel = (name: string) => {
  const key = `settings.extensions.permissions.${name}`;
  return te(key) ? t(key) : name;
};

const reloadWindow = () => {
  location.reload();
};
</script>

<template>
  <section :aria-label="t('settings.extensions.title')">
    <SectionHeader
      :title="t('settings.extensions.title')"
      :subtitle="t('settings.extensions.subtitle')"
    />

    <v-progress-linear
      v-if="state === 'loading'"
      indeterminate
      rounded
      :aria-label="t('settings.extensions.title')"
    />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
      <div class="d-flex align-center ga-3">
        <span class="flex-grow-1">
          {{ t('settings.extensions.loadFailed') }}: {{ error }}
        </span>
        <v-btn
          variant="text"
          prepend-icon="mdi-refresh"
          :loading="busy"
          @click="load"
        >
          {{ t('settings.extensions.retry') }}
        </v-btn>
      </div>
    </v-alert>

    <v-alert
      v-if="needsReload"
      type="info"
      variant="tonal"
      class="mb-6"
      data-testid="extensions-reload"
    >
      <div class="d-flex align-center ga-3">
        <span class="flex-grow-1">{{
          t('settings.extensions.reload.message')
        }}</span>
        <v-btn variant="text" prepend-icon="mdi-reload" @click="reloadWindow">
          {{ t('settings.extensions.reload.action') }}
        </v-btn>
      </div>
    </v-alert>

    <v-alert v-if="switchError" type="error" variant="tonal" class="mb-6">
      {{ t('settings.extensions.switchFailed') }}: {{ switchError }}
    </v-alert>

    <template v-if="state === 'loaded'">
      <div class="d-flex align-center mb-4">
        <p class="text-body-medium text-medium-emphasis">
          {{
            t('settings.extensions.count', { n: items.length }, items.length)
          }}
        </p>
        <v-spacer />
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-refresh"
          :loading="busy"
          @click="load"
        >
          {{ t('settings.extensions.refresh') }}
        </v-btn>
      </div>

      <p
        v-if="items.length === 0"
        class="text-body-medium text-medium-emphasis"
      >
        {{ t('settings.extensions.empty') }}
      </p>

      <ul v-else class="list" :aria-label="t('settings.extensions.listLabel')">
        <li
          v-for="extension in items"
          :key="`${extension.origin}:${extension.id}`"
          :class="{
            muted:
              extension.state === 'overridden' ||
              extension.state === 'disabled',
          }"
        >
          <v-card class="pa-4">
            <div class="d-flex flex-wrap align-center ga-2">
              <h3 class="id text-title-medium font-weight-bold">
                {{ extension.id }}
              </h3>
              <v-chip v-if="extension.version !== null" size="small" label>
                {{
                  t('settings.extensions.version', {
                    version: extension.version,
                  })
                }}
              </v-chip>
              <v-chip size="small" label>
                {{ t(`settings.extensions.origin.${extension.origin}`) }}
              </v-chip>
              <v-chip
                v-if="extension.origin === 'bundled'"
                size="small"
                label
                color="primary"
                variant="tonal"
                data-testid="built-in"
              >
                {{ t('settings.extensions.builtIn') }}
              </v-chip>
              <v-chip
                v-if="
                  extension.state === 'loaded' || extension.state === 'disabled'
                "
                size="small"
                label
                :variant="
                  extension.isolation === 'isolated' ? 'tonal' : 'outlined'
                "
                :color="
                  extension.isolation === 'isolated' ? 'success' : 'warning'
                "
              >
                {{ t(`settings.extensions.isolation.${extension.isolation}`) }}
              </v-chip>
              <v-spacer />
              <span class="d-inline-flex align-center ga-1 text-body-medium">
                <v-icon
                  :icon="STATE_VIEW[extension.state].icon"
                  :color="STATE_VIEW[extension.state].color"
                  size="small"
                  aria-hidden="true"
                />
                {{ t(`settings.extensions.state.${extension.state}`) }}
              </span>
            </div>

            <p
              v-if="extension.message !== null"
              class="message text-body-medium mt-2"
            >
              {{ extension.message }}
            </p>

            <div
              v-if="
                extension.state === 'loaded' || extension.state === 'disabled'
              "
              class="d-flex flex-wrap align-center ga-2 mt-3"
              data-point="permissions"
            >
              <span class="text-body-small text-medium-emphasis">
                {{ t('settings.extensions.permissionsTitle') }}:
              </span>
              <span
                v-if="extension.permissions.length === 0"
                class="text-body-small"
              >
                {{ t('settings.extensions.permissionsNone') }}
              </span>
              <ul v-else class="types">
                <li
                  v-for="permission in extension.permissions"
                  :key="permission"
                >
                  <v-chip size="small" variant="tonal">
                    {{ permissionLabel(permission) }}
                  </v-chip>
                </li>
              </ul>
            </div>
            <p
              v-if="extension.permissions.includes('network')"
              class="text-body-small text-medium-emphasis mt-1"
            >
              {{ t('settings.extensions.networkCaveat') }}
            </p>

            <div
              v-for="group in contributionGroups(extension.contributes)"
              :key="group.point"
              class="d-flex flex-wrap align-center ga-2 mt-3"
              :data-point="group.point"
            >
              <span class="text-body-small text-medium-emphasis">
                {{ t(`settings.extensions.points.${group.point}`) }}:
              </span>
              <ul class="types">
                <li v-for="value in group.values" :key="value">
                  <v-chip size="small" variant="tonal" class="id">
                    {{ value }}
                  </v-chip>
                </li>
              </ul>
            </div>

            <div v-if="hasSwitches(extension)" class="switches mt-3">
              <v-switch
                :model-value="isEnabled(settings, extension.id)"
                :label="t('settings.extensions.enabledLabel')"
                :disabled="switching.has(`enabled:${extension.id}`)"
                color="primary"
                density="compact"
                hide-details
                inset
                :data-testid="`enabled-${extension.id}`"
                @update:model-value="setEnabled(extension.id, $event === true)"
              />
              <v-switch
                :model-value="isTrusted(settings, extension.id)"
                :label="t('settings.extensions.trustLabel')"
                :disabled="switching.has(`trusted:${extension.id}`)"
                color="warning"
                density="compact"
                hide-details
                inset
                :data-testid="`trusted-${extension.id}`"
                @update:model-value="setTrusted(extension.id, $event === true)"
              />
              <p class="text-body-small text-medium-emphasis">
                {{ t('settings.extensions.trustHint') }}
              </p>
            </div>
          </v-card>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
}

.muted {
  opacity: 0.7;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}

.id,
.message {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
</style>
