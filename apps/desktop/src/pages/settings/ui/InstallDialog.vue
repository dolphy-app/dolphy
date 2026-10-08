<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { formatBytes } from '../lib/format.ts';
import type { InstallItemStatus } from '../model/install.ts';
import { useInstallContext } from '../model/install.ts';
import { useInstalledExtensions } from '../model/installed.ts';
import { rowsOfCatalog } from '../lib/dependencies.ts';
import { useEngine } from '@/shared/api/engine';
import ExtensionDeprecation from './ExtensionDeprecation.vue';
import ExtensionTags from './ExtensionTags.vue';
import ExtensionHeading from './ExtensionHeading.vue';
import ExtensionDependencies from './ExtensionDependencies.vue';
import ReadmeView from './ReadmeView.vue';

interface StatusView {
  icon: string;
  color: string;
}

const STATUS_VIEW: Record<InstallItemStatus, StatusView> = {
  pending: { icon: 'mdi-clock-outline', color: 'default' },
  running: { icon: 'mdi-progress-download', color: 'primary' },
  done: { icon: 'mdi-check-circle-outline', color: 'success' },
  failed: { icon: 'mdi-alert-circle-outline', color: 'error' },
};

const { t, locale } = useI18n();
const extensionText = useExtensionText();
const install = useInstallContext();
const installed = useInstalledExtensions(useEngine());

const isOpen = computed(() => install.phase.value !== 'idle');
const isRunning = computed(() => install.phase.value === 'running');
const isFinished = computed(() => install.phase.value === 'finished');
const isDetailed = computed(() => !isFinished.value);

const isUpdate = computed(
  () => (install.items.value[0]?.target.installedVersion ?? null) !== null,
);
const allDone = computed(() =>
  install.items.value.every((item) => item.status === 'done'),
);

const title = computed(() => {
  const { items, phase } = install;
  const [first] = items.value;
  if (phase.value === 'running')
    return t('settings.extensions.install.titleRunning');
  if (phase.value === 'finished') {
    const key = install.succeeded.value ? 'titleFinished' : 'titleFailed';
    return t(`settings.extensions.install.${key}`);
  }
  if (items.value.length !== 1 || first === undefined) {
    return t(
      'settings.extensions.install.titleUpdateAll',
      { n: items.value.length },
      items.value.length,
    );
  }
  const key = isUpdate.value ? 'titleUpdate' : 'titleInstall';
  return t(`settings.extensions.install.${key}`, {
    name: extensionText.of(first.target.name),
  });
});

const closeOnBackdrop = (open: boolean) => {
  if (!open) install.dismiss();
};
</script>

<template>
  <v-dialog
    :model-value="isOpen"
    max-width="640"
    scrollable
    :persistent="isRunning"
    aria-labelledby="extension-install-title"
    @update:model-value="closeOnBackdrop"
  >
    <v-card data-testid="install-dialog">
      <v-card-title id="extension-install-title" class="text-wrap pt-4">
        {{ title }}
      </v-card-title>

      <v-progress-linear
        v-if="isRunning"
        indeterminate
        :aria-label="t('settings.extensions.install.progress')"
      />

      <v-card-text tabindex="0">
        <ul class="items">
          <li
            v-for="item in install.items.value"
            :key="item.target.id"
            :data-extension-id="item.target.id"
          >
            <div class="d-flex flex-wrap align-center ga-2">
              <ExtensionHeading :icon="item.target.icon">
                <h3
                  v-if="install.items.value.length > 1 || isFinished"
                  class="name text-title-medium font-weight-bold"
                >
                  {{ extensionText.of(item.target.name) }}
                </h3>
              </ExtensionHeading>
              <span class="id text-body-small text-medium-emphasis">
                {{ item.target.id }}
              </span>
              <v-chip size="small" label>
                {{
                  item.target.installedVersion === null
                    ? t('settings.extensions.version', {
                        version: item.target.version,
                      })
                    : t('settings.extensions.install.versionChange', {
                        from: item.target.installedVersion,
                        to: item.target.version,
                      })
                }}
              </v-chip>
              <v-spacer />
              <span
                v-if="install.phase.value !== 'confirm'"
                class="d-inline-flex align-center ga-1 text-body-medium"
                :data-status="item.status"
              >
                <v-icon
                  :icon="STATUS_VIEW[item.status].icon"
                  :color="STATUS_VIEW[item.status].color"
                  size="small"
                  aria-hidden="true"
                />
                {{ t(`settings.extensions.install.itemStatus.${item.status}`) }}
              </span>
            </div>

            <p
              v-if="item.target.author !== null"
              class="text-body-small text-medium-emphasis mt-1"
            >
              {{ t('settings.extensions.author') }}:
              <span class="id">@{{ item.target.author }}</span>
            </p>

            <v-alert
              v-if="item.failure"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
              data-testid="install-error"
              :data-reason="item.failure.reason"
            >
              <p>
                {{
                  t(`settings.extensions.install.errors.${item.failure.reason}`)
                }}
              </p>
              <p
                v-if="item.failure.message"
                class="reason text-body-small mt-1"
              >
                {{ item.failure.message }}
              </p>
            </v-alert>

            <template v-if="isDetailed">
              <ExtensionDeprecation
                v-if="item.target.deprecated !== null"
                :deprecation="item.target.deprecated"
                @navigate="install.dismiss"
              />
              <section
                v-if="item.notes.state !== 'none'"
                class="mt-3"
                :aria-labelledby="`whats-new-${item.target.id}`"
                :aria-busy="item.notes.state === 'loading'"
                :data-state="item.notes.state"
                data-testid="whats-new"
              >
                <h4
                  :id="`whats-new-${item.target.id}`"
                  class="text-title-small"
                >
                  {{ t('settings.extensions.install.whatsNew.title') }}
                </h4>
                <p
                  v-if="item.notes.state === 'loading'"
                  class="text-body-small text-medium-emphasis mt-1"
                  role="status"
                >
                  {{ t('settings.extensions.install.whatsNew.loading') }}
                </p>
                <template
                  v-else-if="
                    item.notes.state === 'ready' &&
                    item.notes.sections.length > 0
                  "
                >
                  <ReadmeView
                    v-for="section in item.notes.sections"
                    :key="section.version"
                    :markdown="`## ${section.title}\n\n${section.body}`"
                    :extension-id="item.target.id"
                    :version="item.target.version"
                    :heading-offset="3"
                    :images="false"
                    data-testid="whats-new-section"
                    :data-version="section.version"
                  />
                </template>
                <div v-else data-testid="whats-new-empty">
                  <p class="text-body-medium mt-1">
                    {{
                      item.notes.state === 'failed'
                        ? t('settings.extensions.install.whatsNew.failed')
                        : t('settings.extensions.install.whatsNew.notFound')
                    }}
                  </p>
                  <v-btn
                    variant="text"
                    color="primary"
                    size="small"
                    class="mt-1"
                    prepend-icon="mdi-open-in-app"
                    :aria-label="
                      t('settings.extensions.install.whatsNew.openPageLabel', {
                        name: extensionText.of(item.target.name),
                      })
                    "
                    :to="{
                      name: ROUTE.settingsExtensionDetails,
                      params: { id: item.target.id },
                      query: { version: item.target.version },
                    }"
                    data-testid="whats-new-page"
                    @click="install.dismiss"
                  >
                    {{ t('settings.extensions.install.whatsNew.openPage') }}
                  </v-btn>
                </div>
              </section>
              <ExtensionTags :tags="item.target.tags" />
              <ExtensionDependencies
                :rows="rowsOfCatalog(item.target.dependencies, installed)"
              />
              <p
                v-if="item.target.platforms.length > 0"
                class="text-body-small mt-3"
                data-point="platforms"
              >
                <span class="text-medium-emphasis"
                  >{{ t('settings.extensions.install.platforms') }}:
                </span>
                <span class="id">{{ item.target.platforms.join(', ') }}</span>
              </p>
              <p class="text-body-small mt-1">
                <span class="text-medium-emphasis"
                  >{{ t('settings.extensions.install.size') }}:
                </span>
                {{ formatBytes(item.target.sizeBytes, locale) }}
              </p>
            </template>
          </li>
        </ul>

        <v-alert
          v-if="isFinished && install.succeeded.value"
          type="success"
          variant="tonal"
          class="mt-4"
          data-testid="install-done"
        >
          {{
            allDone
              ? t('settings.extensions.install.done')
              : t('settings.extensions.install.partial')
          }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <template v-if="!isFinished">
          <v-btn variant="text" :disabled="isRunning" @click="install.dismiss">
            {{ t('settings.extensions.install.cancel') }}
          </v-btn>
          <v-btn
            variant="flat"
            color="primary"
            :loading="isRunning"
            :disabled="isRunning"
            data-testid="install-confirm"
            @click="install.confirm"
          >
            {{
              isUpdate || install.items.value.length > 1
                ? t('settings.extensions.install.confirmUpdate')
                : t('settings.extensions.install.confirmInstall')
            }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn
            v-if="install.canRetry.value"
            variant="tonal"
            color="primary"
            data-testid="install-retry"
            @click="install.retry"
          >
            {{ t('settings.extensions.install.retry') }}
          </v-btn>
          <v-btn
            variant="text"
            data-testid="install-close"
            @click="install.dismiss"
          >
            {{ t('settings.extensions.install.close') }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.items {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  list-style: none;
  padding: 0;
}

.id,
.reason {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.name {
  overflow-wrap: anywhere;
}
</style>
