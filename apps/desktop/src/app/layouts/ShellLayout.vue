<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { updatesBadgeText, useExtensionUpdates } from '@/shared/api/engine';
import { APP_NAME } from '@/shared/config/app.ts';
import { extensionIconOf } from '@/shared/config/extension-icons.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useExtensionWhen } from '@/shared/lib/extension-when.ts';

const { t } = useI18n();
const router = useRouter();
const clients = useExtensionClients();
const extensionText = useExtensionText();
const extensionWhen = useExtensionWhen();
const extensionUpdates = useExtensionUpdates();

/** Значок на «Настройках»: сколько расширений можно обновить; без обновлений его нет. */
const updatesBadge = computed(() =>
  updatesBadgeText(extensionUpdates.count.value),
);

// пункт панели с ложным `when` скрыт; сама панель открывается из расширения (`openPanel`)
const panels = computed(() =>
  clients.panels.value.filter(({ when }) => extensionWhen.matches(when)),
);

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
    <!-- панели расширений: список из реестра клиентских частей, названия на языке окна -->
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
        :key="panel.key"
        :to="{
          name: ROUTE.extensionPanel,
          params: { extensionId: panel.extensionId, panelId: panel.id },
        }"
        tabindex="0"
        :prepend-icon="extensionIconOf(panel.icon)"
        :title="extensionText.of(panel.title)"
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
          v-for="item in bottomItems"
          :key="item.name"
          :to="{ name: item.name }"
          tabindex="0"
          :prepend-icon="item.icon"
          :title="t(item.titleKey)"
          color="primary"
          rounded="lg"
          :aria-describedby="
            item.name === ROUTE.settings && updatesBadge
              ? 'nav-updates-hint'
              : undefined
          "
        >
          <template v-if="item.name === ROUTE.settings && updatesBadge" #append>
            <!-- число читает скринридер через описание пункта, значок для него скрыт -->
            <span aria-hidden="true" data-testid="updates-badge-nav">
              <v-badge inline color="primary" :content="updatesBadge" />
            </span>
          </template>
        </v-list-item>
        <span
          v-if="updatesBadge"
          id="nav-updates-hint"
          class="visually-hidden"
          data-testid="updates-hint-nav"
          >{{
            t('common.extensionUpdates', { n: extensionUpdates.count.value })
          }}</span
        >
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

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
