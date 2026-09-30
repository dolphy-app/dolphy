<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { APP_NAME } from '@/shared/config/app.ts';

const { t } = useI18n();
const router = useRouter();

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
</style>
