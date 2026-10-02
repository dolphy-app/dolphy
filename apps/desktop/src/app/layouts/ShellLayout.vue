<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useContributions } from '@/shared/api/engine';
import { APP_NAME } from '@/shared/config/app.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import {
  detectPlatform,
  displayKeybinding,
  PALETTE_KEYBINDING,
} from '@/shared/lib/keybinding.ts';
import { useCommandPalette } from '@/widgets/command-palette';

const { t } = useI18n();
const router = useRouter();
const contributions = useContributions();
const palette = useCommandPalette();
const paletteHint = displayKeybinding(PALETTE_KEYBINDING, detectPlatform());

const panels = computed(() => contributions.value.panels);

const items = computed(() =>
  router
    .getRoutes()
    .flatMap((route) =>
      route.meta.nav && route.name
        ? [{ name: route.name, ...route.meta.nav }]
        : [],
    )
    .sort((a, b) => a.order - b.order),
);
const topItems = computed(() =>
  items.value.filter((item) => item.placement !== 'bottom'),
);
const bottomItems = computed(() =>
  items.value.filter((item) => item.placement === 'bottom'),
);
</script>

<template>
  <v-navigation-drawer permanent width="240" border="e" elevation="0">
    <div class="d-flex align-center ga-3 px-5 py-5">
      <v-avatar color="primary" rounded="lg" size="36">
        <v-icon icon="mdi-brain" />
      </v-avatar>
      <span class="text-title-large font-weight-bold">{{ APP_NAME }}</span>
    </div>
    <v-divider />
    <!-- ссылки меню — обычные остановки Tab, а не пункты списка со стрелками -->
    <v-list
      nav
      role="navigation"
      class="pa-3"
      tabindex="-1"
      :aria-label="t('nav.main')"
    >
      <v-list-item
        v-for="item in topItems"
        :key="item.name"
        :to="{ name: item.name }"
        tabindex="0"
        exact
        :prepend-icon="item.icon"
        :title="t(item.titleKey)"
        color="primary"
        rounded="lg"
      />
    </v-list>
    <!-- панели расширений: список из реактивных вкладов, названия — данные расширения -->
    <v-list
      v-if="panels.length > 0"
      nav
      role="navigation"
      class="px-3 pb-3 pt-0"
      tabindex="-1"
      :aria-label="t('nav.extensions')"
      data-testid="extension-nav"
    >
      <v-list-item
        v-for="panel in panels"
        :key="`${panel.extensionId}:${panel.id}`"
        :to="{
          name: ROUTE.extensionPanel,
          params: { extensionId: panel.extensionId, panelId: panel.id },
        }"
        tabindex="0"
        prepend-icon="mdi-puzzle-outline"
        :title="panel.title"
        color="primary"
        rounded="lg"
      />
    </v-list>
    <template #append>
      <v-list
        nav
        role="navigation"
        class="pa-3"
        tabindex="-1"
        :aria-label="t('nav.more')"
      >
        <v-list-item
          tabindex="0"
          role="button"
          prepend-icon="mdi-console-line"
          :title="t('nav.commands')"
          aria-keyshortcuts="Control+K Meta+K"
          rounded="lg"
          data-testid="open-palette"
          @click="palette.open()"
        >
          <template #append>
            <kbd class="palette-hint" data-testid="open-palette-hint">{{
              paletteHint
            }}</kbd>
          </template>
        </v-list-item>
        <v-list-item
          v-for="item in bottomItems"
          :key="item.name"
          :to="{ name: item.name }"
          tabindex="0"
          :prepend-icon="item.icon"
          :title="t(item.titleKey)"
          color="primary"
          rounded="lg"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
  <v-main>
    <router-view />
  </v-main>
</template>

<style scoped>
.v-list-item :deep(.v-list-item__spacer) {
  width: 12px;
}

/* VHotkey: рамка и скругление клавиши */
.palette-hint {
  padding: 0 6px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: nowrap;
  opacity: var(--v-medium-emphasis-opacity);
}
</style>
