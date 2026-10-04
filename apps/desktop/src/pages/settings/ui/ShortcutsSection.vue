<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SpokenId } from '@dolphy-app/keybindings';
import { describeChord, useKeybindings } from '@/features/keybindings';
import { useCommandRegistry } from '@/shared/lib/command-registry.ts';
import { useCommandPalette } from '@/widgets/command-palette';
import { createShortcutEditor } from '../model/shortcut-editor.ts';
import { defaultWhenOf, useShortcuts } from '../model/shortcuts.ts';
import type { ShortcutBindingView, ShortcutRow } from '../model/shortcuts.ts';
import FilterChip from './FilterChip.vue';
import SectionHeader from './SectionHeader.vue';
import ShortcutDialog from './ShortcutDialog.vue';

const { t } = useI18n();
const palette = useCommandPalette();
const registry = useCommandRegistry();
const keybindings = useKeybindings();
const word = (id: SpokenId) => t(`keybinding.${id}`);

const shortcuts = useShortcuts({ registry, keybindings, word });
const { filters, groups } = shortcuts;
const editor = createShortcutEditor({ registry, keybindings });

const PALETTE_COMMAND = 'app:palette.open';
const paletteKeys = computed(() => {
  const binding = keybindings.primary(PALETTE_COMMAND);
  return binding === undefined
    ? null
    : describeChord(binding.chord, keybindings.platform, word).keys;
});

const confirmingReset = ref(false);
const canResetAll = computed(
  () => Object.keys(keybindings.user.value).length > 0,
);

const edit = (row: ShortcutRow, binding: ShortcutBindingView) =>
  editor.open(
    { command: row.key, title: row.title, previous: binding.entry },
    binding.when ?? '',
  );
const add = (row: ShortcutRow) =>
  editor.open(
    { command: row.key, title: row.title, previous: null },
    defaultWhenOf(row),
  );
const resetAll = async () => {
  confirmingReset.value = false;
  await editor.resetAll();
};

const failureText = computed(() => {
  const failure = editor.actionFailure.value;
  if (failure === null) return null;
  return t(`settings.shortcuts.failed.${failure.reason}`, {
    field: failure.field ?? '',
    command: failure.command ?? '',
    other: failure.other ?? '',
    message: failure.message,
  });
});
</script>

<template>
  <section>
    <SectionHeader
      :title="t('settings.shortcuts.title')"
      :subtitle="t('settings.shortcuts.subtitle')"
    />

    <v-card class="px-5 py-4 mb-6">
      <div class="text-title-medium font-weight-bold">
        {{ t('settings.shortcuts.palette.title') }}
      </div>
      <p class="text-body-medium text-medium-emphasis mb-4">
        {{ t('settings.shortcuts.palette.description') }}
      </p>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-console-line"
        data-testid="open-palette"
        @click="palette.open()"
      >
        {{ t('settings.shortcuts.palette.open') }}
        <kbd v-if="paletteKeys" class="keys ml-3" aria-hidden="true">{{
          paletteKeys
        }}</kbd>
      </v-btn>
    </v-card>

    <v-alert
      v-if="failureText"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mb-4"
      role="alert"
      data-testid="shortcuts-failure"
      @click:close="editor.actionFailure.value = null"
      >{{ failureText }}</v-alert
    >

    <div
      class="d-flex flex-wrap align-center ga-3 mb-4"
      role="group"
      :aria-label="t('settings.shortcuts.toolbar.label')"
    >
      <v-text-field
        v-model="filters.query"
        class="search"
        type="search"
        variant="outlined"
        density="comfortable"
        clearable
        hide-details
        prepend-inner-icon="mdi-magnify"
        :label="t('settings.shortcuts.toolbar.search')"
        :placeholder="t('settings.shortcuts.toolbar.searchHint')"
        data-testid="shortcuts-search"
      />
      <FilterChip
        :selected="filters.changedOnly"
        :label="t('settings.shortcuts.toolbar.changed')"
        :count="shortcuts.customizedCount.value"
        data-testid="shortcuts-filter-changed"
        @toggle="filters.changedOnly = !filters.changedOnly"
      />
      <FilterChip
        :selected="filters.conflictsOnly"
        :label="t('settings.shortcuts.toolbar.conflicts')"
        :count="shortcuts.conflictCount.value"
        data-testid="shortcuts-filter-conflicts"
        @toggle="filters.conflictsOnly = !filters.conflictsOnly"
      />
      <v-spacer />
      <v-btn
        variant="outlined"
        prepend-icon="mdi-restore"
        :disabled="!canResetAll"
        data-testid="shortcuts-reset-all"
        @click="confirmingReset = true"
      >
        {{ t('settings.shortcuts.toolbar.resetAll') }}
      </v-btn>
    </div>

    <p
      v-if="shortcuts.rows.value.length === 0"
      class="text-body-medium text-medium-emphasis"
    >
      {{ t('settings.shortcuts.empty') }}
    </p>
    <p
      v-else-if="groups.length === 0"
      class="text-body-medium text-medium-emphasis"
      role="status"
    >
      {{ t('settings.shortcuts.noMatches') }}
    </p>

    <v-card
      v-for="(group, index) in groups"
      :key="group.category ?? ''"
      class="px-5 py-4 mb-3"
    >
      <h3 :id="`shortcuts-group-${index}`" class="text-title-medium mb-2">
        {{ group.category ?? t('settings.shortcuts.noCategory') }}
      </h3>
      <table class="table" :aria-labelledby="`shortcuts-group-${index}`">
        <thead>
          <tr>
            <th scope="col">{{ t('settings.shortcuts.columns.command') }}</th>
            <th scope="col">{{ t('settings.shortcuts.columns.keys') }}</th>
            <th scope="col">{{ t('settings.shortcuts.columns.when') }}</th>
            <th scope="col">{{ t('settings.shortcuts.columns.source') }}</th>
            <th scope="col">{{ t('settings.shortcuts.columns.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in group.rows"
            :key="row.key"
            data-testid="shortcut"
            :data-command="row.key"
          >
            <td>
              <div>{{ row.title }}</div>
              <div v-if="row.caption" class="text-medium-emphasis small">
                {{ row.caption }}
              </div>
            </td>
            <td>
              <ul class="cells">
                <li
                  v-for="binding in row.bindings"
                  :key="binding.entry.key + (binding.entry.when ?? '')"
                  class="cell"
                >
                  <span class="chord">
                    <kbd
                      v-for="(stroke, strokeIndex) in binding.strokes"
                      :key="strokeIndex"
                      class="keys"
                      aria-hidden="true"
                      >{{ stroke }}</kbd
                    >
                    <span class="visually-hidden">{{ binding.spoken }}</span>
                  </span>
                  <v-btn
                    icon="mdi-pencil-outline"
                    size="x-small"
                    variant="text"
                    :aria-label="
                      t('settings.shortcuts.actions.edit', {
                        keys: binding.spoken,
                        title: row.title,
                      })
                    "
                    data-testid="shortcut-edit"
                    @click="edit(row, binding)"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    :aria-label="
                      t('settings.shortcuts.actions.remove', {
                        keys: binding.spoken,
                        title: row.title,
                      })
                    "
                    data-testid="shortcut-remove"
                    @click="editor.remove(row.key, binding.entry)"
                  />
                </li>
              </ul>
              <span
                v-if="row.bindings.length === 0"
                class="text-medium-emphasis small"
                >{{ t('settings.shortcuts.none') }}</span
              >
            </td>
            <td>
              <ul class="cells">
                <li
                  v-for="binding in row.bindings"
                  :key="binding.entry.key + (binding.entry.when ?? '')"
                  class="cell"
                >
                  <code v-if="binding.when" class="when">{{
                    binding.when
                  }}</code>
                  <span v-else class="text-medium-emphasis small">{{
                    t('settings.shortcuts.always')
                  }}</span>
                </li>
              </ul>
            </td>
            <td>
              <v-chip
                v-if="row.source"
                size="small"
                variant="outlined"
                label
                data-testid="shortcut-source"
                >{{ t(`settings.shortcuts.source.${row.source}`) }}</v-chip
              >
              <ul v-if="row.conflicts.length > 0" class="conflicts">
                <li
                  v-for="(conflict, conflictIndex) in row.conflicts"
                  :key="conflictIndex"
                  data-testid="shortcut-conflict"
                >
                  <v-icon
                    icon="mdi-alert-outline"
                    size="small"
                    color="warning"
                    aria-hidden="true"
                  />
                  <span class="visually-hidden"
                    >{{ t('settings.shortcuts.conflict.badge') }}:
                  </span>
                  {{
                    t(
                      `settings.shortcuts.conflict.${conflict.kind}.${conflict.wins ? 'wins' : 'loses'}`,
                      { other: conflict.otherTitle, keys: conflict.otherKeys },
                    )
                  }}
                </li>
              </ul>
            </td>
            <td class="actions">
              <v-btn
                icon="mdi-plus"
                size="small"
                variant="text"
                :aria-label="
                  t('settings.shortcuts.actions.add', { title: row.title })
                "
                data-testid="shortcut-add"
                @click="add(row)"
              />
              <v-btn
                v-if="row.customized"
                icon="mdi-restore"
                size="small"
                variant="text"
                :aria-label="
                  t('settings.shortcuts.actions.reset', { title: row.title })
                "
                data-testid="shortcut-reset"
                @click="editor.reset(row.key)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </v-card>

    <ShortcutDialog :editor="editor" :platform="keybindings.platform" />

    <v-dialog v-model="confirmingReset" max-width="440">
      <v-card data-testid="shortcuts-reset-dialog">
        <v-card-title class="text-title-large">{{
          t('settings.shortcuts.resetAll.title')
        }}</v-card-title>
        <v-card-text>{{ t('settings.shortcuts.resetAll.text') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmingReset = false">{{
            t('settings.shortcuts.resetAll.cancel')
          }}</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            data-testid="shortcuts-reset-confirm"
            @click="resetAll"
            >{{ t('settings.shortcuts.resetAll.confirm') }}</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.search {
  flex: 1 1 18rem;
  max-width: 28rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 8px 8px 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  text-align: start;
  vertical-align: top;
  font-size: 0.875rem;
}

.table th {
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.table tbody tr:last-child td {
  border-bottom: none;
}

.actions {
  white-space: nowrap;
}

.cells {
  margin: 0;
  padding: 0;
  list-style: none;
}

.cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
}

.chord {
  display: inline-flex;
  gap: 4px;
}

.small {
  font-size: 0.75rem;
}

.when {
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.conflicts {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* VHotkey: рамка и скругление клавиши */
.keys {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: nowrap;
}
</style>
