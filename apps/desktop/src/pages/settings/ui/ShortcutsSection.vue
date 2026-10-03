<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useCommandRegistry } from '@/shared/lib/command-registry.ts';
import {
  detectPlatform,
  displayKeybinding,
  PALETTE_KEYBINDING,
  spokenKeybinding,
} from '@/shared/lib/keybinding.ts';
import type { SpokenId } from '@/shared/lib/keybinding.ts';
import { useCommandPalette } from '@/widgets/command-palette';
import { useShortcutGroups } from '../model/shortcuts.ts';
import SectionHeader from './SectionHeader.vue';

const { t } = useI18n();
const platform = detectPlatform();
const palette = useCommandPalette();
const groups = useShortcutGroups(useCommandRegistry());
const keys = (keybinding: string) => displayKeybinding(keybinding, platform);
// `⌘K` скринридер читает набором символов: рядом с клавишей лежит озвучивание словами
const spoken = (keybinding: string) =>
  spokenKeybinding(keybinding, platform, (id: SpokenId) =>
    t(`keybinding.${id}`),
  );
const paletteKeys = displayKeybinding(PALETTE_KEYBINDING, platform);
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
        :aria-keyshortcuts="'Control+K Meta+K'"
        @click="palette.open()"
      >
        {{ t('settings.shortcuts.palette.open') }}
        <kbd class="keys ml-3" aria-hidden="true">{{ paletteKeys }}</kbd>
      </v-btn>
    </v-card>

    <p v-if="groups.length === 0" class="text-body-medium text-medium-emphasis">
      {{ t('settings.shortcuts.empty') }}
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
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.rows" :key="row.key" data-testid="shortcut">
            <td>{{ row.title }}</td>
            <td>
              <kbd class="keys" aria-hidden="true">{{
                keys(row.keybinding)
              }}</kbd>
              <span class="visually-hidden">{{ spoken(row.keybinding) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </v-card>

    <p class="text-body-small text-medium-emphasis mt-4">
      {{ t('settings.shortcuts.note') }}
    </p>
  </section>
</template>

<style scoped>
.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  text-align: start;
  font-size: 0.875rem;
}

.table th {
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.table th:last-child,
.table td:last-child {
  width: 10rem;
}

.table tbody tr:last-child td {
  border-bottom: none;
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
