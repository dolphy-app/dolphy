<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  CatalogEntryDto,
  CatalogVersionDto,
} from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import {
  CONTRIBUTION_POINTS,
  entryAction,
  targetFromEntry,
} from '../lib/catalog.ts';
import type { ContributionPoint } from '../lib/catalog.ts';
import { useCatalog } from '../model/catalog.ts';
import { useInstallContext } from '../model/install.ts';
import ExtensionContributions from './ExtensionContributions.vue';
import ExtensionIcon from './ExtensionIcon.vue';
import ExtensionPermissions from './ExtensionPermissions.vue';

const SKELETON_COUNT = 3;

const { t, d } = useI18n();
const install = useInstallContext();
const {
  state,
  entries,
  visible,
  query,
  kinds,
  isFiltered,
  stale,
  notice,
  fetchedAt,
  busy,
  failure,
  open,
  load,
  setKind,
  resetFilters,
} = useCatalog(useEngine());

const fetchedDate = computed(() =>
  fetchedAt.value === null ? null : new Date(fetchedAt.value),
);

const rows = computed(() =>
  visible.value.map((entry) => ({ entry, action: entryAction(entry) })),
);

const isLoading = computed(
  () => state.value === 'idle' || state.value === 'loading',
);

const review = (entry: CatalogEntryDto, version: CatalogVersionDto) => {
  install.review([targetFromEntry(entry, version)]);
};

const toggleKind = (point: ContributionPoint) => {
  setKind(point, !kinds.value.has(point));
};

onMounted(() => void open());
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-start ga-3">
      <v-text-field
        v-model="query"
        class="search"
        type="search"
        variant="outlined"
        density="comfortable"
        clearable
        hide-details
        prepend-inner-icon="mdi-magnify"
        :label="t('settings.extensions.catalog.searchLabel')"
        :placeholder="t('settings.extensions.catalog.searchHint')"
        :disabled="state === 'failed'"
        data-testid="catalog-search"
      />
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        class="mt-1"
        :loading="busy"
        data-testid="catalog-refresh"
        @click="load({ refresh: true })"
      >
        {{ t('settings.extensions.catalog.refresh') }}
      </v-btn>
    </div>

    <div
      role="group"
      class="d-flex flex-wrap align-center ga-2 mt-3 mb-4"
      :aria-label="t('settings.extensions.catalog.kindsLabel')"
    >
      <v-chip
        v-for="point in CONTRIBUTION_POINTS"
        :key="point"
        role="button"
        tabindex="0"
        :aria-pressed="kinds.has(point)"
        :variant="kinds.has(point) ? 'flat' : 'tonal'"
        :color="kinds.has(point) ? 'primary' : undefined"
        :prepend-icon="kinds.has(point) ? 'mdi-check' : undefined"
        :data-testid="`kind-${point}`"
        @click="toggleKind(point)"
        @keydown.enter.prevent="toggleKind(point)"
        @keydown.space.prevent="toggleKind(point)"
      >
        {{ t(`settings.extensions.points.${point}`) }}
      </v-chip>
    </div>

    <v-alert
      v-if="stale && state === 'loaded'"
      type="info"
      variant="tonal"
      class="mb-4"
      data-testid="catalog-offline"
    >
      <p>{{ t('settings.extensions.catalog.offline') }}</p>
      <p v-if="notice" class="reason text-body-small mt-1">
        {{ t('settings.extensions.catalog.reason', { reason: notice }) }}
      </p>
      <p v-if="fetchedDate" class="text-body-small mt-1">
        {{
          t('settings.extensions.catalog.fetchedAt', {
            date: d(fetchedDate, 'shortDateTime'),
          })
        }}
      </p>
    </v-alert>

    <div v-if="isLoading" role="status" aria-busy="true">
      <span class="visually-hidden">{{
        t('settings.extensions.catalog.loading')
      }}</span>
      <v-skeleton-loader
        v-for="index in SKELETON_COUNT"
        :key="index"
        type="article"
        class="mb-3"
      />
    </div>

    <v-alert
      v-else-if="state === 'failed'"
      type="error"
      variant="tonal"
      :title="t('settings.extensions.catalog.unavailable')"
      data-testid="catalog-unavailable"
    >
      <div class="d-flex align-center ga-3">
        <span class="reason flex-grow-1">
          {{ t('settings.extensions.catalog.reason', { reason: failure }) }}
        </span>
        <v-btn
          variant="text"
          prepend-icon="mdi-refresh"
          :loading="busy"
          @click="load()"
        >
          {{ t('settings.extensions.retry') }}
        </v-btn>
      </div>
    </v-alert>

    <template v-else>
      <p
        class="text-body-medium text-medium-emphasis mb-3"
        role="status"
        aria-live="polite"
      >
        {{
          t(
            'settings.extensions.catalog.found',
            { n: rows.length },
            rows.length,
          )
        }}
      </p>

      <div
        v-if="rows.length === 0"
        class="text-body-medium text-medium-emphasis"
      >
        <p v-if="entries.length === 0 || !isFiltered">
          {{ t('settings.extensions.catalog.empty') }}
        </p>
        <template v-else>
          <p>{{ t('settings.extensions.catalog.noMatches') }}</p>
          <v-btn
            variant="text"
            color="primary"
            class="mt-2"
            @click="resetFilters"
          >
            {{ t('settings.extensions.catalog.resetFilters') }}
          </v-btn>
        </template>
      </div>

      <ul
        v-else
        class="list"
        :aria-label="t('settings.extensions.catalog.listLabel')"
      >
        <li
          v-for="{ entry, action } in rows"
          :key="entry.id"
          :data-extension-id="entry.id"
        >
          <v-card class="pa-4">
            <div class="d-flex flex-wrap align-center ga-2">
              <ExtensionIcon :src="entry.icon" />
              <h3 class="name text-title-medium font-weight-bold">
                {{ entry.name }}
              </h3>
              <span class="id text-body-small text-medium-emphasis">
                {{ entry.id }}
              </span>
              <v-chip v-if="entry.latest" size="small" label>
                {{
                  t('settings.extensions.version', {
                    version: entry.latest.version,
                  })
                }}
              </v-chip>
            </div>

            <p class="text-body-small text-medium-emphasis mt-1">
              <span class="visually-hidden"
                >{{ t('settings.extensions.author') }}:
              </span>
              <span class="id">@{{ entry.author }}</span>
            </p>
            <p class="text-body-medium mt-2">{{ entry.description }}</p>

            <ExtensionPermissions
              v-if="entry.latest"
              :permissions="entry.latest.permissions"
            />
            <ExtensionContributions :contributes="entry.contributes" />

            <div
              class="d-flex flex-wrap align-center ga-3 mt-4"
              :data-status="action.kind"
            >
              <template v-if="action.kind === 'install'">
                <v-btn
                  variant="flat"
                  color="primary"
                  prepend-icon="mdi-download-outline"
                  :disabled="install.phase.value === 'running'"
                  :aria-label="
                    t('settings.extensions.action.installLabel', {
                      name: entry.name,
                      version: action.version.version,
                    })
                  "
                  :data-testid="`install-${entry.id}`"
                  @click="review(entry, action.version)"
                >
                  {{ t('settings.extensions.action.install') }}
                </v-btn>
              </template>

              <template v-else-if="action.kind === 'installed'">
                <span
                  class="d-inline-flex align-center ga-1 text-body-medium"
                  :data-testid="`installed-${entry.id}`"
                >
                  <v-icon
                    icon="mdi-check-circle-outline"
                    color="success"
                    size="small"
                    aria-hidden="true"
                  />
                  {{
                    t('settings.extensions.catalog.installedStatus', {
                      version: action.version,
                    })
                  }}
                </span>
              </template>

              <template v-else-if="action.kind === 'update'">
                <span class="text-body-medium">
                  {{
                    t('settings.extensions.catalog.installedFrom', {
                      version: action.installed,
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
                      name: entry.name,
                      version: action.version.version,
                    })
                  "
                  :data-testid="`update-${entry.id}`"
                  @click="review(entry, action.version)"
                >
                  {{
                    t('settings.extensions.action.update', {
                      version: action.version.version,
                    })
                  }}
                </v-btn>
              </template>

              <template v-else>
                <v-btn
                  variant="flat"
                  color="primary"
                  prepend-icon="mdi-download-outline"
                  disabled
                  :aria-describedby="`incompatible-${entry.id}`"
                  :aria-label="
                    t('settings.extensions.action.installDisabledLabel', {
                      name: entry.name,
                    })
                  "
                  :data-testid="`install-${entry.id}`"
                >
                  {{ t('settings.extensions.action.install') }}
                </v-btn>
                <p
                  :id="`incompatible-${entry.id}`"
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
                      detail: action.detail,
                    })
                  }}</span>
                </p>
                <v-btn
                  v-if="action.fallback"
                  variant="tonal"
                  color="primary"
                  size="small"
                  :disabled="install.phase.value === 'running'"
                  :aria-label="
                    t('settings.extensions.action.installFallbackLabel', {
                      name: entry.name,
                      version: action.fallback.version,
                    })
                  "
                  :data-testid="`install-fallback-${entry.id}`"
                  @click="review(entry, action.fallback)"
                >
                  {{
                    t('settings.extensions.action.installFallback', {
                      version: action.fallback.version,
                    })
                  }}
                </v-btn>
              </template>
            </div>
          </v-card>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.search {
  flex: 1 1 18rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
}

.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.reason {
  overflow-wrap: anywhere;
}

.name {
  overflow-wrap: anywhere;
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
