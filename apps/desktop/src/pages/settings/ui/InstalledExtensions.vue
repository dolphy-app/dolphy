<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ExtensionDiagnosticDto,
  ExtensionInfoDto,
  ExtensionStateDto,
} from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { useContributions } from '@/shared/api/engine/contributions.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { effectiveTags } from '../lib/tags.ts';
import {
  areNotificationsOn,
  areSchedulesOn,
  hasNotifications,
  hasSchedules,
  hasSwitches,
  isEnabled,
  isTrusted,
  scheduleSummaryOf,
  useExtensions,
} from '../model/extensions.ts';
import { useDiagnosticsCopy } from '../model/diagnostics-copy.ts';
import { useExtensionData } from '../model/extension-data.ts';
import { useInstallContext } from '../model/install.ts';
import { isFromAnotherCatalog } from '../lib/catalog-source.ts';
import { useCatalogSource } from '../model/catalog-source.ts';
import DeprecatedChip from './DeprecatedChip.vue';
import ExtensionContributions from './ExtensionContributions.vue';
import ExtensionDeprecation from './ExtensionDeprecation.vue';
import ExtensionTags from './ExtensionTags.vue';
import ExtensionData from './ExtensionData.vue';
import ExtensionHealth from './ExtensionHealth.vue';
import ExtensionHeading from './ExtensionHeading.vue';
import ExtensionPermissions from './ExtensionPermissions.vue';
import ExtensionRemoveDialog from './ExtensionRemoveDialog.vue';
import ExtensionSettingsDialog from './ExtensionSettingsDialog.vue';
import ExtensionLogDialog from './ExtensionLogDialog.vue';

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

const props = defineProps<{ active: boolean }>();

const { t } = useI18n();
const extensionText = useExtensionText();
const install = useInstallContext();
const {
  items,
  updates,
  settings,
  state,
  error,
  busy,
  load,
  switching,
  switchError,
  diagnostics,
  restartingHost,
  setEnabled,
  setTrusted,
  setNotifications,
  setSchedules,
  setCheckUpdates,
  setSafeMode,
  restartHost,
  updateTargets,
} = useExtensions(useEngine());
const catalogSource = useCatalogSource(useEngine());

const { source } = catalogSource;
onMounted(() => void catalogSource.load());

const contributions = useContributions();
/** Расписания включённых расширений по id расширения, в порядке манифеста. */
const schedulesByExtension = computed(() => {
  const map = new Map<string, string[]>();
  for (const schedule of contributions.value.schedules) {
    const { key, at } = scheduleSummaryOf(schedule);
    const texts = map.get(schedule.extensionId) ?? [];
    texts.push(t(`settings.extensions.schedule.${key}`, { at }));
    map.set(schedule.extensionId, texts);
  }
  return map;
});

const removeTarget = ref<ExtensionInfoDto | null>(null);
const settingsTarget = ref<ExtensionInfoDto | null>(null);
/** Диалог журнала: `''` — все записи, иначе предустановленный фильтр по id. */
const logTarget = ref<string | null>(null);
const diagnosticsCopy = useDiagnosticsCopy(useEngine(), {
  appInfo: () => window.dolphy.platform.appInfo(),
  // системный буфер пишет main: navigator.clipboard не работает без фокуса окна
  writeText: (text) => window.dolphy.platform.copyText(text),
});
const data = useExtensionData(useEngine(), items);

/** Настройки есть у загруженного (включённого) расширения, объявившего `settings`. */
const issuesOf = (diagnostic: ExtensionDiagnosticDto): string[] => {
  const { issues } = diagnostic.data;
  return Array.isArray(issues) ? issues : [];
};

const diagnosticText = (diagnostic: ExtensionDiagnosticDto): string =>
  t(
    `settings.extensions.diagnostic.${diagnostic.code}`,
    diagnostic.code === 'overridden-by'
      ? {
          ...diagnostic.data,
          origin: t(`settings.extensions.origin.${diagnostic.data.origin}`),
        }
      : diagnostic.data,
  );

// предупреждений о переводах может быть несколько с одним кодом: ключ отличает данные
const diagnosticKey = (diagnostic: ExtensionDiagnosticDto): string =>
  `${diagnostic.code}:${diagnostic.data.key ?? diagnostic.data.file ?? ''}`;

/** Предупреждения о переводах: расширение работает, поэтому они выделены иначе, чем причины сбоя. */
const isWarning = (diagnostic: ExtensionDiagnosticDto): boolean =>
  diagnostic.code.startsWith('locale.');

const healthOf = (id: string) =>
  diagnostics.value?.extensions.find((health) => health.id === id);

const hasSettings = (extension: ExtensionInfoDto) =>
  extension.state === 'loaded' && extension.contributes.settings.length > 0;

const updateOf = (id: string) =>
  updates.value.find((update) => update.id === id);

const isMuted = (extension: ExtensionInfoDto) =>
  extension.state === 'overridden' || extension.state === 'disabled';

const isActive = (extension: ExtensionInfoDto) =>
  extension.state === 'loaded' || extension.state === 'disabled';

const reviewUpdates = async (ids?: readonly string[]) => {
  install.review(await updateTargets(ids));
};

// кнопка, открывшая диалог: после закрытия фокус возвращается на неё
let opener: HTMLElement | null = null;

const rememberOpener = (event: Event) => {
  opener =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
};

const restoreFocus = () => {
  void nextTick(() => opener?.focus());
};

const openSettings = (extension: ExtensionInfoDto, event: Event) => {
  rememberOpener(event);
  settingsTarget.value = extension;
};

const closeSettings = () => {
  settingsTarget.value = null;
  restoreFocus();
};

const openLog = (extensionId: string, event: Event) => {
  rememberOpener(event);
  logTarget.value = extensionId;
};

const closeLog = () => {
  logTarget.value = null;
  restoreFocus();
};

const askRemove = (extension: ExtensionInfoDto, event: Event) => {
  rememberOpener(event);
  removeTarget.value = extension;
};

const closeRemove = () => {
  removeTarget.value = null;
  restoreFocus();
};

// обновления могли появиться, пока открыт «Каталог»: при возврате читаем заново
watch(
  () => props.active,
  (active) => {
    if (active) void load();
  },
);
</script>

<template>
  <div>
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

    <v-alert v-if="switchError" type="error" variant="tonal" class="mb-6">
      {{ t('settings.extensions.switchFailed') }}: {{ switchError }}
    </v-alert>

    <v-alert
      v-if="data.clearError.value"
      type="error"
      variant="tonal"
      class="mb-6"
    >
      {{ t('settings.extensions.data.failed') }}: {{ data.clearError.value }}
    </v-alert>

    <template v-if="state === 'loaded'">
      <v-alert
        v-if="diagnostics?.host === 'gave-up'"
        type="error"
        variant="tonal"
        class="mb-6"
        :title="t('settings.extensions.host.gaveUpTitle')"
        data-testid="host-gave-up"
      >
        <div class="d-flex align-center ga-3">
          <span class="flex-grow-1">{{
            t('settings.extensions.host.gaveUpText')
          }}</span>
          <v-btn
            variant="flat"
            color="error"
            prepend-icon="mdi-restart"
            :loading="restartingHost"
            data-testid="host-restart"
            @click="restartHost"
          >
            {{ t('settings.extensions.host.restart') }}
          </v-btn>
        </div>
      </v-alert>

      <v-alert
        v-if="updates.length > 0"
        type="info"
        variant="tonal"
        class="mb-6"
        data-testid="extensions-updates"
      >
        <div class="d-flex align-center ga-3">
          <span class="flex-grow-1">{{
            t(
              'settings.extensions.installed.updatesBanner',
              { n: updates.length },
              updates.length,
            )
          }}</span>
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-update"
            :disabled="install.phase.value === 'running'"
            @click="reviewUpdates(updates.map(({ id }) => id))"
          >
            {{ t('settings.extensions.installed.updateAll') }}
          </v-btn>
        </div>
      </v-alert>

      <div class="d-flex flex-wrap align-center ga-4 mb-4">
        <p class="text-body-medium text-medium-emphasis">
          {{
            t('settings.extensions.count', { n: items.length }, items.length)
          }}
        </p>
        <v-spacer />
        <v-switch
          :model-value="settings.checkUpdates"
          :label="t('settings.extensions.installed.checkUpdates')"
          :disabled="switching.has('checkUpdates')"
          color="primary"
          density="compact"
          hide-details
          inset
          data-testid="check-updates"
          @update:model-value="setCheckUpdates($event === true)"
        />
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

      <div class="mb-4" data-testid="safe-mode-section">
        <v-switch
          :model-value="settings.safeMode"
          :label="t('settings.extensions.safeMode.label')"
          :hint="t('settings.extensions.safeMode.hint')"
          :disabled="switching.has('safeMode')"
          color="warning"
          density="compact"
          persistent-hint
          inset
          data-testid="safe-mode"
          @update:model-value="setSafeMode($event === true)"
        />
        <p
          v-if="diagnostics?.safeMode.forcedBy"
          class="text-body-small text-medium-emphasis mt-1"
          data-testid="safe-mode-forced"
        >
          {{ t('settings.extensions.safeMode.forced') }}
        </p>
      </div>

      <div class="mb-4" data-testid="diagnostics-section">
        <h3 class="text-title-small">
          {{ t('settings.extensions.support.title') }}
        </h3>
        <p class="text-body-small text-medium-emphasis mt-1">
          {{ t('settings.extensions.support.hint') }}
        </p>
        <div class="d-flex flex-wrap align-center ga-2 mt-2">
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-text-box-search-outline"
            data-testid="extensions-log-open"
            @click="openLog('', $event)"
          >
            {{ t('settings.extensions.support.openLog') }}
          </v-btn>
          <v-btn
            variant="tonal"
            :color="
              diagnosticsCopy.state.value === 'failed' ? 'error' : 'primary'
            "
            :prepend-icon="
              diagnosticsCopy.state.value === 'copied'
                ? 'mdi-check'
                : 'mdi-content-copy'
            "
            :loading="diagnosticsCopy.state.value === 'copying'"
            data-testid="extensions-copy-diagnostics"
            @click="diagnosticsCopy.copy"
          >
            {{
              diagnosticsCopy.state.value === 'copied'
                ? t('settings.extensions.support.copied')
                : t('settings.extensions.support.copy')
            }}
          </v-btn>
        </div>
        <v-alert
          v-if="diagnosticsCopy.state.value === 'failed'"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
          data-testid="extensions-copy-failed"
        >
          {{ t('settings.extensions.support.copyFailed') }}:
          {{ diagnosticsCopy.error.value }}
        </v-alert>
        <span class="visually-hidden" role="status">{{
          diagnosticsCopy.state.value === 'copied'
            ? t('settings.extensions.support.copied')
            : ''
        }}</span>
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
          :class="{ muted: isMuted(extension) }"
          :data-extension-id="extension.id"
        >
          <v-card class="pa-4">
            <div class="d-flex flex-wrap align-center ga-2">
              <ExtensionHeading :icon="extension.icon">
                <h3 class="name text-title-medium font-weight-bold">
                  <router-link
                    class="details-link"
                    :to="{
                      name: ROUTE.settingsExtensionDetails,
                      params: { id: extension.id },
                    }"
                    :data-testid="`details-${extension.id}`"
                  >
                    {{ extensionText.nameOf(extension) }}
                  </router-link>
                </h3>
              </ExtensionHeading>
              <span
                v-if="extension.name !== null"
                class="id text-body-small text-medium-emphasis"
              >
                {{ extension.id }}
              </span>
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
                v-if="
                  extension.installed !== null &&
                  isFromAnotherCatalog(extension.installed, source?.url ?? null)
                "
                size="small"
                label
                variant="outlined"
                prepend-icon="mdi-storefront-outline"
                :aria-describedby="`other-catalog-${extension.id}`"
                data-testid="from-other-catalog"
              >
                {{
                  t('settings.extensions.installed.fromOtherCatalog', {
                    version: extension.installed.version,
                  })
                }}
              </v-chip>
              <v-chip
                v-else-if="extension.installed !== null"
                size="small"
                label
                color="primary"
                variant="tonal"
                prepend-icon="mdi-storefront-outline"
                data-testid="from-catalog"
              >
                {{
                  t('settings.extensions.installed.fromCatalog', {
                    version: extension.installed.version,
                  })
                }}
              </v-chip>
              <DeprecatedChip v-if="extension.deprecated !== null" />
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
                v-if="isActive(extension)"
                size="small"
                label
                :variant="
                  extension.isolation === 'isolated' ? 'tonal' : 'outlined'
                "
                :color="
                  extension.isolation === 'isolated' ? 'success' : undefined
                "
                :prepend-icon="
                  extension.isolation === 'isolated'
                    ? 'mdi-shield-check-outline'
                    : 'mdi-shield-alert-outline'
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
              v-if="
                isFromAnotherCatalog(extension.installed, source?.url ?? null)
              "
              :id="`other-catalog-${extension.id}`"
              class="text-body-small text-medium-emphasis mt-1"
              data-testid="other-catalog-hint"
            >
              {{ t('settings.extensions.installed.otherCatalogHint') }}
            </p>
            <p
              v-if="extension.author !== null"
              class="text-body-small text-medium-emphasis mt-1"
            >
              <span class="visually-hidden"
                >{{ t('settings.extensions.author') }}:
              </span>
              <span class="id">@{{ extension.author }}</span>
            </p>
            <p
              v-if="extension.description !== null"
              class="text-body-medium mt-2"
            >
              {{
                extensionText.withTables(
                  extension.description,
                  extension.messages,
                )
              }}
            </p>
            <ExtensionTags
              :tags="effectiveTags(extension.tags, extension.contributes)"
            />

            <ExtensionDeprecation
              v-if="extension.deprecated !== null"
              :deprecation="extension.deprecated"
            />

            <v-alert
              v-if="extension.revoked !== null"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
              :title="t('settings.extensions.installed.revokedTitle')"
              data-testid="revoked"
            >
              <p>
                {{
                  t('settings.extensions.installed.revokedReason', {
                    reason: extension.revoked,
                  })
                }}
              </p>
              <p class="text-body-small mt-1">
                {{ t('settings.extensions.installed.revokedHint') }}
              </p>
            </v-alert>

            <template
              v-for="diagnostic in extension.diagnostics"
              :key="diagnosticKey(diagnostic)"
            >
              <!-- предупреждение: расширение работает, поэтому не сообщение об ошибке -->
              <v-alert
                v-if="isWarning(diagnostic)"
                type="warning"
                variant="tonal"
                density="compact"
                class="mt-2"
                data-testid="diagnostic"
                :data-code="diagnostic.code"
              >
                {{ diagnosticText(diagnostic) }}
              </v-alert>
              <div
                v-else
                class="text-body-medium mt-2"
                data-testid="diagnostic"
                :data-code="diagnostic.code"
              >
                <p>{{ diagnosticText(diagnostic) }}</p>
                <ul
                  v-if="diagnostic.code === 'manifest-invalid'"
                  class="message ps-4"
                >
                  <li v-for="issue in issuesOf(diagnostic)" :key="issue">
                    {{ issue }}
                  </li>
                </ul>
              </div>
            </template>

            <ExtensionHealth
              v-if="isActive(extension)"
              :health="healthOf(extension.id)"
            />

            <ExtensionPermissions
              v-if="isActive(extension)"
              :permissions="extension.permissions"
            />
            <ExtensionContributions
              :contributes="extension.contributes"
              :titles="extension.titles"
              :name="extension.name"
              :messages="extension.messages"
            />
            <ExtensionData
              v-if="isActive(extension)"
              :extension="extension"
              :usage="data.usage.value.get(extension.id)"
              :clearing="data.clearing.value === extension.id"
              @clear="data.clear(extension.id)"
            />

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
                v-if="hasNotifications(extension)"
                :model-value="areNotificationsOn(settings, extension.id)"
                :label="t('settings.extensions.notificationsLabel')"
                :disabled="switching.has(`notifications:${extension.id}`)"
                color="primary"
                density="compact"
                hide-details
                inset
                :data-testid="`notifications-${extension.id}`"
                @update:model-value="
                  setNotifications(extension.id, $event === true)
                "
              />
              <v-switch
                v-if="hasSchedules(extension)"
                :model-value="areSchedulesOn(settings, extension.id)"
                :label="t('settings.extensions.schedulesLabel')"
                :disabled="switching.has(`schedules:${extension.id}`)"
                :aria-describedby="`schedules-text-${extension.id}`"
                color="primary"
                density="compact"
                hide-details
                inset
                :data-testid="`schedules-${extension.id}`"
                @update:model-value="
                  setSchedules(extension.id, $event === true)
                "
              />
              <p
                v-if="hasSchedules(extension)"
                :id="`schedules-text-${extension.id}`"
                class="text-body-small text-medium-emphasis mt-0 mb-2"
                :data-testid="`schedules-text-${extension.id}`"
              >
                {{ (schedulesByExtension.get(extension.id) ?? []).join(' · ') }}
              </p>
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

            <div class="d-flex flex-wrap ga-2 mt-3">
              <v-btn
                v-if="hasSettings(extension)"
                variant="tonal"
                size="small"
                prepend-icon="mdi-cog-outline"
                :aria-label="
                  t('settings.extensions.action.settingsLabel', {
                    name: extensionText.nameOf(extension),
                  })
                "
                :data-testid="`settings-${extension.id}`"
                @click="openSettings(extension, $event)"
              >
                {{ t('settings.extensions.action.settings') }}
              </v-btn>
              <v-btn
                variant="tonal"
                size="small"
                prepend-icon="mdi-text-box-search-outline"
                :aria-label="
                  t('settings.extensions.log.rowActionLabel', {
                    name: extensionText.nameOf(extension),
                  })
                "
                :data-testid="`extension-log-open-${extension.id}`"
                @click="openLog(extension.id, $event)"
              >
                {{ t('settings.extensions.log.rowAction') }}
              </v-btn>
              <v-btn
                v-if="updateOf(extension.id)"
                variant="tonal"
                color="primary"
                size="small"
                prepend-icon="mdi-update"
                :disabled="install.phase.value === 'running'"
                :aria-label="
                  t('settings.extensions.action.updateLabel', {
                    name: extensionText.nameOf(extension),
                    version: updateOf(extension.id)?.available.version,
                  })
                "
                :data-testid="`update-${extension.id}`"
                @click="reviewUpdates([extension.id])"
              >
                {{
                  t('settings.extensions.action.update', {
                    version: updateOf(extension.id)?.available.version,
                  })
                }}
              </v-btn>
              <v-btn
                v-if="extension.removable"
                variant="text"
                color="error"
                size="small"
                prepend-icon="mdi-delete-outline"
                :aria-label="
                  t('settings.extensions.action.removeLabel', {
                    name: extensionText.nameOf(extension),
                  })
                "
                :data-testid="`remove-${extension.id}`"
                @click="askRemove(extension, $event)"
              >
                {{ t('settings.extensions.action.remove') }}
              </v-btn>
            </div>
          </v-card>
        </li>
      </ul>
    </template>

    <ExtensionRemoveDialog :target="removeTarget" @close="closeRemove" />

    <ExtensionSettingsDialog
      v-if="settingsTarget !== null"
      :key="settingsTarget.id"
      :extension="settingsTarget"
      @close="closeSettings"
    />

    <ExtensionLogDialog
      v-if="logTarget !== null"
      :preset-extension-id="logTarget"
      :extension-ids="items.map(({ id }) => id)"
      @close="closeLog"
    />
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
}

/* приглушённая строка: рамка пунктиром, а не прозрачность (она роняет контраст текста) */
.muted :deep(.v-card) {
  border-style: dashed;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.id,
.message {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.name {
  overflow-wrap: anywhere;
}

.details-link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.details-link:hover,
.details-link:focus-visible {
  text-decoration: underline;
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
