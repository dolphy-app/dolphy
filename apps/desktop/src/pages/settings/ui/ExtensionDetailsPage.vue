<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type {
  CatalogVersionDto,
  ExtensionInfoDto,
} from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { targetFromEntry, targetFromUpdate } from '../lib/catalog.ts';
import { isFromAnotherCatalog } from '../lib/catalog-source.ts';
import { formatBytes } from '../lib/format.ts';
import { useCatalogSource } from '../model/catalog-source.ts';
import { useExtensionDetails } from '../model/extension-details.ts';
import { useInstallContext } from '../model/install.ts';
import DeprecatedChip from './DeprecatedChip.vue';
import ExtensionContributions from './ExtensionContributions.vue';
import ExtensionDeprecation from './ExtensionDeprecation.vue';
import ExtensionHeading from './ExtensionHeading.vue';
import ExtensionDependencies from './ExtensionDependencies.vue';
import ExtensionRemoveDialog from './ExtensionRemoveDialog.vue';
import ExtensionTags from './ExtensionTags.vue';
import ReadmeView from './ReadmeView.vue';

const { t, d, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const engine = useEngine();
const extensionText = useExtensionText();
const install = useInstallContext();

const id = computed(() => String(route.params['id'] ?? ''));
const requestedVersion = computed(() => {
  const value = route.query['version'];
  return typeof value === 'string' ? value : null;
});

const {
  state,
  details,
  docs,
  catalogError,
  catalogStale,
  error,
  load,
  retryDocs,
} = useExtensionDetails(engine, id, requestedVersion);

const catalogSource = useCatalogSource(engine);
onMounted(() => void catalogSource.load());
const fromOtherCatalog = computed(() =>
  isFromAnotherCatalog(
    details.value?.info?.installed ?? null,
    catalogSource.source.value?.url ?? null,
  ),
);

const name = computed(() => {
  const view = details.value;
  if (view === null) return id.value;
  if (view.info !== null) return extensionText.nameOf(view.info);
  return view.entry?.name ?? view.id;
});

const description = computed(() => {
  const view = details.value;
  if (view === null) return null;
  if (view.info !== null) {
    return view.info.description === null
      ? null
      : extensionText.withTables(view.info.description, view.info.messages);
  }
  return view.entry?.description ?? null;
});

const docsVersion = computed(() =>
  docs.value.status === 'ready' ? docs.value.docs.version : null,
);

// с каталогом (в том числе устаревшим) страница показывает версии и ссылки, без него — только установленное
const showCatalogGone = computed(
  () =>
    details.value !== null &&
    details.value.entry === null &&
    catalogError.value !== null,
);

const back = () => {
  // возврат туда, откуда пришли (вкладка списка сохраняется в адресе); без истории — к списку
  if (window.history.state?.back) router.back();
  else void router.push({ name: ROUTE.settingsExtensions });
};

const showVersion = (version: string) => {
  void router.replace({ query: { ...route.query, version } });
};

const reviewVersion = (version: CatalogVersionDto) => {
  const entry = details.value?.entry;
  if (entry) install.review([targetFromEntry(entry, version)]);
};

const reviewUpdate = (installed: string, version: CatalogVersionDto) => {
  const view = details.value;
  if (view === null) return;
  if (view.entry !== null) {
    install.review([targetFromEntry(view.entry, version)]);
    return;
  }
  install.review([
    targetFromUpdate(
      { id: view.id, name: name.value, installed, available: version },
      view.info ?? undefined,
      undefined,
    ),
  ]);
};

const removeTarget = ref<ExtensionInfoDto | null>(null);
let opener: HTMLElement | null = null;

const askRemove = (info: ExtensionInfoDto, event: Event) => {
  opener =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  removeTarget.value = info;
};

const closeRemove = () => {
  removeTarget.value = null;
  void nextTick(() => opener?.focus());
};

const publishedDate = (value: string) => d(new Date(value), 'shortDate');
</script>

<template>
  <section
    :aria-label="name"
    data-testid="extension-details"
    :data-extension-id="id"
  >
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-4"
      :aria-label="t('settings.extensions.details.backLabel')"
      data-testid="details-back"
      @click="back"
    >
      {{ t('settings.extensions.details.back') }}
    </v-btn>

    <div v-if="state === 'loading'" role="status" aria-busy="true">
      <span class="visually-hidden">{{
        t('settings.extensions.details.loading')
      }}</span>
      <v-skeleton-loader type="article" />
    </div>

    <v-alert
      v-else-if="state === 'failed'"
      type="error"
      variant="tonal"
      :title="t('settings.extensions.details.loadFailed')"
      data-testid="details-failed"
    >
      <div class="d-flex align-center ga-3">
        <span class="reason flex-grow-1">{{ error }}</span>
        <v-btn variant="text" prepend-icon="mdi-refresh" @click="load">
          {{ t('settings.extensions.retry') }}
        </v-btn>
      </div>
    </v-alert>

    <v-alert
      v-else-if="details === null"
      type="info"
      variant="tonal"
      :title="t('settings.extensions.details.notFoundTitle')"
      data-testid="details-not-found"
    >
      <span class="reason">{{
        t('settings.extensions.details.notFound', { id })
      }}</span>
    </v-alert>

    <template v-else>
      <v-card class="pa-5 mb-4">
        <div class="d-flex flex-wrap align-center ga-2">
          <ExtensionHeading :icon="details.icon">
            <h2 class="name text-title-large font-weight-bold">{{ name }}</h2>
          </ExtensionHeading>
          <span class="id text-body-small text-medium-emphasis">
            {{ details.id }}
          </span>
          <v-chip
            v-if="details.installedVersion !== null"
            size="small"
            label
            color="primary"
            variant="tonal"
            prepend-icon="mdi-storefront-outline"
            data-testid="from-catalog"
          >
            {{
              t('settings.extensions.installed.fromCatalog', {
                version: details.installedVersion,
              })
            }}
          </v-chip>
          <v-chip v-else-if="details.info?.version" size="small" label>
            {{
              t('settings.extensions.version', {
                version: details.info.version,
              })
            }}
          </v-chip>
          <v-chip v-if="details.info" size="small" label>
            {{ t(`settings.extensions.origin.${details.info.origin}`) }}
          </v-chip>
          <v-chip
            v-if="fromOtherCatalog"
            size="small"
            label
            variant="outlined"
            prepend-icon="mdi-storefront-outline"
            data-testid="from-other-catalog"
          >
            {{ t('settings.extensions.installed.fromOtherCatalogShort') }}
          </v-chip>
          <v-chip
            v-if="details.info?.origin === 'bundled'"
            size="small"
            label
            color="primary"
            variant="tonal"
            data-testid="built-in"
          >
            {{ t('settings.extensions.builtIn') }}
          </v-chip>
          <v-chip
            v-if="details.info && details.info.state !== 'loaded'"
            size="small"
            label
            variant="outlined"
          >
            {{ t(`settings.extensions.state.${details.info.state}`) }}
          </v-chip>
          <DeprecatedChip v-if="details.deprecation !== null" />
        </div>

        <p
          v-if="details.author !== null"
          class="text-body-small text-medium-emphasis mt-2"
        >
          <span class="visually-hidden"
            >{{ t('settings.extensions.author') }}:
          </span>
          <a
            v-if="details.authorUrl !== null"
            class="id author"
            :href="details.authorUrl"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="
              t('settings.extensions.details.authorProfile', {
                author: details.author,
              })
            "
            data-testid="details-author"
            >@{{ details.author }}</a
          >
          <span v-else class="id">{{ details.author }}</span>
        </p>
        <p v-if="description !== null" class="text-body-medium mt-3">
          {{ description }}
        </p>
        <ExtensionTags :tags="details.tags" />

        <ExtensionDeprecation
          v-if="details.deprecation !== null"
          :deprecation="details.deprecation"
        />

        <v-alert
          v-if="showCatalogGone"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="details-catalog-unavailable"
        >
          <p>{{ t('settings.extensions.details.catalogUnavailable') }}</p>
          <p class="reason text-body-small mt-1">
            {{
              t('settings.extensions.catalog.reason', { reason: catalogError })
            }}
          </p>
        </v-alert>
        <v-alert
          v-else-if="catalogStale"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="details-catalog-offline"
        >
          {{ t('settings.extensions.details.catalogOffline') }}
        </v-alert>

        <v-alert
          v-if="details.info !== null && details.info.revoked !== null"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          :title="t('settings.extensions.installed.revokedTitle')"
          data-testid="revoked"
        >
          {{
            t('settings.extensions.installed.revokedReason', {
              reason: details.info.revoked,
            })
          }}
        </v-alert>

        <ExtensionDependencies :rows="details.dependencies" />
        <ExtensionContributions
          :contributes="details.contributes"
          :titles="details.titles"
          :name="name"
          :messages="details.messages"
        />

        <p v-if="details.sourceUrl !== null" class="text-body-medium mt-3">
          <a
            :href="details.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="source"
            :aria-label="t('settings.extensions.details.sourceLabel', { name })"
            data-testid="details-source"
          >
            <v-icon icon="mdi-open-in-new" size="small" aria-hidden="true" />
            {{ t('settings.extensions.details.source') }}
          </a>
        </p>

        <div
          class="d-flex flex-wrap align-center ga-3 mt-4"
          :data-status="details.action?.kind ?? 'none'"
          data-testid="details-actions"
        >
          <template v-if="details.action?.kind === 'install'">
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-download-outline"
              :disabled="install.phase.value === 'running'"
              :aria-label="
                t('settings.extensions.action.installLabel', {
                  name,
                  version: details.action.version.version,
                })
              "
              :data-testid="`install-${details.id}`"
              @click="reviewVersion(details.action.version)"
            >
              {{ t('settings.extensions.action.install') }}
            </v-btn>
          </template>

          <template v-else-if="details.action?.kind === 'elsewhere'">
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-download-outline"
              disabled
              :aria-describedby="`elsewhere-${details.id}`"
              :aria-label="
                t('settings.extensions.action.elsewhereLabel', { name })
              "
              :data-testid="`install-${details.id}`"
            >
              {{ t('settings.extensions.action.install') }}
            </v-btn>
            <p
              :id="`elsewhere-${details.id}`"
              class="d-flex align-center ga-1 text-body-small"
              data-testid="elsewhere"
            >
              <v-icon
                icon="mdi-information-outline"
                size="small"
                aria-hidden="true"
              />
              <span
                >{{ t('settings.extensions.action.elsewhere') }}.
                {{ t('settings.extensions.action.elsewhereHint') }}</span
              >
            </p>
          </template>

          <template v-else-if="details.action?.kind === 'installed'">
            <span
              class="d-inline-flex align-center ga-1 text-body-medium"
              :data-testid="`installed-${details.id}`"
            >
              <v-icon
                icon="mdi-check-circle-outline"
                color="success"
                size="small"
                aria-hidden="true"
              />
              {{
                t('settings.extensions.details.installedStatus', {
                  version: details.action.version,
                })
              }}
            </span>
          </template>

          <template v-else-if="details.action?.kind === 'update'">
            <span class="text-body-medium">
              {{
                t('settings.extensions.catalog.installedFrom', {
                  version: details.action.installed,
                })
              }}
            </span>
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-update"
              :disabled="install.phase.value === 'running'"
              :aria-label="
                t('settings.extensions.action.updateLabel', {
                  name,
                  version: details.action.version.version,
                })
              "
              :data-testid="`update-${details.id}`"
              @click="
                reviewUpdate(details.action.installed, details.action.version)
              "
            >
              {{
                t('settings.extensions.action.update', {
                  version: details.action.version.version,
                })
              }}
            </v-btn>
          </template>

          <template v-else-if="details.action?.kind === 'incompatible'">
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-download-outline"
              disabled
              :aria-describedby="`incompatible-${details.id}`"
              :aria-label="
                t('settings.extensions.action.installDisabledLabel', { name })
              "
              :data-testid="`install-${details.id}`"
            >
              {{ t('settings.extensions.action.install') }}
            </v-btn>
            <p
              :id="`incompatible-${details.id}`"
              class="d-flex align-center ga-1 text-body-small"
              data-testid="incompatible"
            >
              <v-icon
                icon="mdi-alert-outline"
                color="warning"
                size="small"
                aria-hidden="true"
              />
              <span class="reason">{{
                t('settings.extensions.catalog.incompatible', {
                  detail: details.action.detail,
                })
              }}</span>
            </p>
            <v-btn
              v-if="details.action.fallback"
              variant="tonal"
              color="primary"
              size="small"
              :disabled="install.phase.value === 'running'"
              :aria-label="
                t('settings.extensions.action.installFallbackLabel', {
                  name,
                  version: details.action.fallback.version,
                })
              "
              :data-testid="`install-fallback-${details.id}`"
              @click="reviewVersion(details.action.fallback)"
            >
              {{
                t('settings.extensions.action.installFallback', {
                  version: details.action.fallback.version,
                })
              }}
            </v-btn>
          </template>

          <v-btn
            v-if="details.removable && details.info"
            variant="text"
            color="error"
            prepend-icon="mdi-delete-outline"
            :aria-label="t('settings.extensions.action.removeLabel', { name })"
            :data-testid="`remove-${details.id}`"
            @click="askRemove(details.info, $event)"
          >
            {{ t('settings.extensions.action.remove') }}
          </v-btn>
        </div>
      </v-card>

      <v-card
        v-if="details.versions.length > 0"
        class="pa-5 mb-4"
        data-testid="details-versions"
      >
        <h3 class="text-title-medium font-weight-bold mb-2">
          {{ t('settings.extensions.details.versions.title') }}
        </h3>
        <ul
          class="versions"
          :aria-label="t('settings.extensions.details.versions.listLabel')"
        >
          <li
            v-for="row in details.versions"
            :key="row.version"
            class="d-flex flex-wrap align-center ga-2"
            :data-version="row.version"
            :data-testid="`version-${row.version}`"
          >
            <span class="id font-weight-bold">v{{ row.version }}</span>
            <span class="text-body-small text-medium-emphasis">
              {{
                t('settings.extensions.details.versions.published', {
                  date: publishedDate(row.publishedAt),
                })
              }}
              · {{ formatBytes(row.size, locale) }}
            </span>
            <v-chip
              v-if="row.incompatible === null"
              size="small"
              label
              color="success"
              variant="tonal"
              prepend-icon="mdi-check"
            >
              {{ t('settings.extensions.details.versions.compatible') }}
            </v-chip>
            <v-chip
              v-else
              size="small"
              label
              color="warning"
              variant="tonal"
              prepend-icon="mdi-alert-outline"
              data-testid="version-incompatible"
            >
              {{
                t('settings.extensions.details.versions.incompatible', {
                  detail: row.incompatible.detail,
                })
              }}
            </v-chip>
            <v-chip
              v-if="row.installed"
              size="small"
              label
              color="primary"
              variant="tonal"
              data-testid="version-installed"
            >
              {{ t('settings.extensions.details.versions.installed') }}
            </v-chip>
            <v-spacer />
            <v-chip
              v-if="row.selected"
              size="small"
              label
              variant="outlined"
              prepend-icon="mdi-text-box-outline"
              data-testid="version-shown"
            >
              {{ t('settings.extensions.details.versions.shown') }}
            </v-chip>
            <v-btn
              v-else
              variant="text"
              size="small"
              class="text-body-small font-weight-medium"
              :aria-label="
                t('settings.extensions.details.versions.showLabel', {
                  version: row.version,
                })
              "
              :data-testid="`version-show-${row.version}`"
              @click="showVersion(row.version)"
            >
              {{ t('settings.extensions.details.versions.show') }}
            </v-btn>
          </li>
        </ul>
      </v-card>

      <v-card
        v-if="docs.status === 'ready' && docs.docs.changelog !== null"
        class="pa-5 mb-4"
        data-testid="details-changelog"
      >
        <h3 class="text-title-medium font-weight-bold mb-2">
          {{ t('settings.extensions.details.changelog.title') }}
          <span
            class="text-body-small text-medium-emphasis font-weight-regular"
          >
            v{{ docs.docs.version }}
          </span>
        </h3>
        <ReadmeView
          :markdown="docs.docs.changelog"
          :extension-id="details.id"
          :version="docs.docs.version"
          :heading-offset="3"
          :images="false"
        />
      </v-card>

      <v-card class="pa-5" data-testid="details-readme">
        <h3 class="text-title-medium font-weight-bold mb-2">
          {{ t('settings.extensions.details.readme.title') }}
          <span
            v-if="docsVersion !== null"
            class="text-body-small text-medium-emphasis font-weight-regular"
          >
            v{{ docsVersion }}
          </span>
        </h3>

        <div
          v-if="docs.status === 'loading'"
          role="status"
          aria-busy="true"
          data-testid="readme-loading"
        >
          <span class="visually-hidden">{{
            t('settings.extensions.details.readme.loading')
          }}</span>
          <v-skeleton-loader type="paragraph, paragraph" />
        </div>

        <v-alert
          v-else-if="docs.status === 'failed'"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="readme-unavailable"
          :data-reason="docs.reason ?? undefined"
        >
          <div class="d-flex align-center ga-3">
            <div class="flex-grow-1">
              <p class="text-title-small font-weight-bold">
                {{ t('settings.extensions.details.readme.unavailable') }}
              </p>
              <p class="reason text-body-medium mt-1">
                {{
                  t('settings.extensions.details.readme.reason', {
                    reason: docs.message,
                  })
                }}
              </p>
            </div>
            <v-btn
              variant="text"
              prepend-icon="mdi-refresh"
              data-testid="readme-retry"
              @click="retryDocs"
            >
              {{ t('settings.extensions.retry') }}
            </v-btn>
          </div>
        </v-alert>

        <template v-else>
          <v-alert
            v-if="docs.docs.source === 'cache'"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-3"
            data-testid="readme-offline"
          >
            {{ t('settings.extensions.details.readme.offline') }}
          </v-alert>
          <ReadmeView
            v-if="docs.docs.readme !== null"
            :markdown="docs.docs.readme"
            :extension-id="details.id"
            :version="docs.docs.version"
          />
          <p
            v-else
            class="text-body-medium text-medium-emphasis"
            data-testid="readme-none"
          >
            {{ t('settings.extensions.details.readme.none') }}
          </p>
          <p
            v-if="docs.docs.truncated"
            class="text-body-small text-medium-emphasis mt-3"
            data-testid="readme-truncated"
          >
            {{ t('settings.extensions.details.readme.truncated') }}
          </p>
        </template>
      </v-card>
    </template>

    <ExtensionRemoveDialog :target="removeTarget" @close="closeRemove" />
  </section>
</template>

<style scoped>
.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.name,
.reason {
  overflow-wrap: anywhere;
}

.author,
.source {
  color: rgb(var(--v-theme-primary));
}

.versions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
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
