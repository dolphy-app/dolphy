<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  CatalogEntryDto,
  CatalogVersionDto,
} from '@dolphy-app/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import {
  CONTRIBUTION_POINTS,
  entryAction,
  entryTags,
  targetFromEntry,
} from '../lib/catalog.ts';
import type { ContributionPoint } from '../lib/catalog.ts';
import { GROUPS, TAGS } from '../lib/tags.ts';
import type { ExtensionTag, TagGroup } from '../lib/tags.ts';
import { useCatalog } from '../model/catalog.ts';
import { useInstallContext } from '../model/install.ts';
import { useInstalledExtensions } from '../model/installed.ts';
import { rowsOfCatalog } from '../lib/dependencies.ts';
import CatalogAdvanced from './CatalogAdvanced.vue';
import DeprecatedChip from './DeprecatedChip.vue';
import ExtensionContributions from './ExtensionContributions.vue';
import ExtensionDeprecation from './ExtensionDeprecation.vue';
import ExtensionHeading from './ExtensionHeading.vue';
import ExtensionDependencies from './ExtensionDependencies.vue';
import ExtensionPermissions from './ExtensionPermissions.vue';
import ExtensionTags from './ExtensionTags.vue';
import FilterChip from './FilterChip.vue';

const SKELETON_COUNT = 3;

const { t, d } = useI18n();
const install = useInstallContext();
const installed = useInstalledExtensions(useEngine());
const {
  state,
  entries,
  visible,
  query,
  groups,
  tags,
  kinds,
  counts,
  moreOpen,
  moreActive,
  isFiltered,
  stale,
  notice,
  fetchedAt,
  busy,
  failure,
  open,
  load,
  setGroup,
  setTag,
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

const toggleGroup = (group: TagGroup) => {
  setGroup(group, !groups.value.has(group));
};

const toggleTag = (tag: ExtensionTag) => {
  setTag(tag, !tags.value.has(tag));
};

const toggleKind = (point: ContributionPoint) => {
  setKind(point, !kinds.value.has(point));
};

// группа без расширений скрыта, если не выбрана (иначе её нечем снять)
const shownGroups = computed(() =>
  GROUPS.filter(
    (group) => counts.value.groups[group] > 0 || groups.value.has(group),
  ),
);

// теги, которых нет в загруженном каталоге, не показываются
const shownTags = computed(() =>
  TAGS.filter((tag) => counts.value.tags[tag] > 0 || tags.value.has(tag)),
);

const moreShown = computed(() => moreOpen.value || moreActive.value);

const chipLabel = (label: string, n: number) =>
  t('settings.extensions.catalog.chipCount', { label, n });

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
      class="d-flex flex-wrap align-center ga-2 mt-3"
      :aria-label="t('settings.extensions.catalog.groupsLabel')"
      data-testid="catalog-groups"
    >
      <FilterChip
        v-for="group in shownGroups"
        :key="group"
        :selected="groups.has(group)"
        :label="t(`settings.extensions.groups.${group}`)"
        :count="counts.groups[group]"
        :aria-label="
          chipLabel(
            t(`settings.extensions.groups.${group}`),
            counts.groups[group],
          )
        "
        :data-testid="`group-${group}`"
        @toggle="toggleGroup(group)"
      />
      <v-btn
        variant="text"
        size="small"
        color="primary"
        :append-icon="moreShown ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        :disabled="moreActive"
        :aria-expanded="moreShown"
        aria-controls="catalog-more-filters"
        data-testid="catalog-more-filters-toggle"
        @click="moreOpen = !moreOpen"
      >
        {{ t('settings.extensions.catalog.moreFilters') }}
      </v-btn>
    </div>

    <div
      v-show="moreShown"
      id="catalog-more-filters"
      class="mt-2"
      data-testid="catalog-more-filters"
    >
      <div
        role="group"
        class="d-flex flex-wrap align-center ga-2 mb-2"
        :aria-label="t('settings.extensions.catalog.kindsLabel')"
      >
        <span
          class="caption text-body-small text-medium-emphasis"
          aria-hidden="true"
        >
          {{ t('settings.extensions.catalog.kindsCaption') }}
        </span>
        <FilterChip
          v-for="point in CONTRIBUTION_POINTS"
          :key="point"
          :selected="kinds.has(point)"
          :label="t(`settings.extensions.points.${point}`)"
          :data-testid="`kind-${point}`"
          @toggle="toggleKind(point)"
        />
      </div>
      <div
        v-if="shownTags.length > 0"
        role="group"
        class="d-flex flex-wrap align-center ga-2"
        :aria-label="t('settings.extensions.catalog.tagsLabel')"
      >
        <span
          class="caption text-body-small text-medium-emphasis"
          aria-hidden="true"
        >
          {{ t('settings.extensions.tagsLabel') }}
        </span>
        <FilterChip
          v-for="tag in shownTags"
          :key="tag"
          :selected="tags.has(tag)"
          :label="t(`settings.extensions.tags.${tag}`)"
          :count="counts.tags[tag]"
          :aria-label="
            chipLabel(t(`settings.extensions.tags.${tag}`), counts.tags[tag])
          "
          :data-testid="`tag-${tag}`"
          @toggle="toggleTag(tag)"
        />
      </div>
    </div>

    <div class="mb-4" />

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
              <ExtensionHeading :icon="entry.icon">
                <h3 class="name text-title-medium font-weight-bold">
                  <router-link
                    class="details-link"
                    :to="{
                      name: ROUTE.settingsExtensionDetails,
                      params: { id: entry.id },
                    }"
                    :data-testid="`details-${entry.id}`"
                  >
                    {{ entry.name }}
                  </router-link>
                </h3>
              </ExtensionHeading>
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
              <DeprecatedChip v-if="entry.deprecated !== null" />
            </div>

            <p class="text-body-small text-medium-emphasis mt-1">
              <span class="visually-hidden"
                >{{ t('settings.extensions.author') }}:
              </span>
              <span class="id">@{{ entry.author }}</span>
            </p>
            <p class="text-body-medium mt-2">{{ entry.description }}</p>
            <ExtensionTags :tags="entryTags(entry)" />

            <ExtensionDeprecation
              v-if="entry.deprecated !== null"
              :deprecation="entry.deprecated"
            />

            <ExtensionPermissions
              v-if="entry.latest"
              :permissions="entry.latest.permissions"
            />
            <ExtensionDependencies
              v-if="entry.latest"
              :rows="rowsOfCatalog(entry.latest.dependencies, installed)"
            />
            <ExtensionContributions
              :contributes="entry.contributes"
              :titles="entry.titles"
              :name="entry.name"
            />

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

              <template v-else-if="action.kind === 'elsewhere'">
                <v-btn
                  variant="flat"
                  color="primary"
                  prepend-icon="mdi-download-outline"
                  disabled
                  :aria-describedby="`elsewhere-${entry.id}`"
                  :aria-label="
                    t('settings.extensions.action.elsewhereLabel', {
                      name: entry.name,
                    })
                  "
                  :data-testid="`install-${entry.id}`"
                >
                  {{ t('settings.extensions.action.install') }}
                </v-btn>
                <p
                  :id="`elsewhere-${entry.id}`"
                  class="d-flex align-center ga-1 text-body-small"
                  data-testid="elsewhere"
                >
                  <v-icon
                    icon="mdi-information-outline"
                    size="small"
                    aria-hidden="true"
                  />
                  <span class="reason"
                    >{{ t('settings.extensions.action.elsewhere') }}.
                    {{ t('settings.extensions.action.elsewhereHint') }}</span
                  >
                </p>
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

    <CatalogAdvanced @changed="load({ refresh: true })" />
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

.caption {
  min-width: 6.5rem;
}

.reason {
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
