<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useCourseScope } from '@/features/course-scope';
import { panelKey, useExtensionCommands } from '@/features/extension-commands';
import { useContributions } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { resolvePanel } from '../model/panel.ts';
import PanelHost from './PanelHost.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contributions = useContributions();
const clients = useExtensionClients();
const extensionText = useExtensionText();
const { panelProps } = useExtensionCommands();
const scope = useCourseScope();
// курс в фокусе доходит до панели без её пересоздания
const context = computed(() => ({ courseId: scope.activeId.value }));

const extensionId = computed(() => String(route.params['extensionId']));
const panelId = computed(() => String(route.params['panelId']));
const key = computed(() => panelKey(extensionId.value, panelId.value));
const resolved = computed(() =>
  resolvePanel(
    clients.panels.value,
    contributions.value,
    extensionId.value,
    panelId.value,
  ),
);
// клиентская часть расширения ещё грузится или не загрузилась: панели нет, но причина известна
const clientState = computed(() => clients.states.value.get(extensionId.value));

const panelTitle = computed(() =>
  resolved.value === null ? '' : extensionText.of(resolved.value.panel.title),
);

// панель с `header: false` сама рисует заголовок: приложение шапку не показывает
const ownHeader = computed(() => resolved.value?.panel.header === false);

const heading = useTemplateRef<HTMLElement>('heading');
const host = useTemplateRef<InstanceType<typeof PanelHost>>('host');

// при входе фокус получает заголовок страницы, а без шапки — контейнер панели
watch(
  [key, () => (ownHeader.value ? resolved.value?.panel.key : null)],
  async ([, bodyKey], [previous]) => {
    if (previous !== undefined && previous !== key.value) {
      panelProps.clear(previous);
    }
    await nextTick();
    if (bodyKey === null || bodyKey === undefined) heading.value?.focus();
    else host.value?.focus();
  },
  { immediate: true, flush: 'post' },
);
onBeforeUnmount(() => panelProps.clear(key.value));

const missingTitle = computed(() => {
  const status = clientState.value?.status;
  if (status === 'loading') return '';
  return status === 'failed'
    ? t('extensionPanel.loadFailed')
    : t('extensionPanel.unavailable.title');
});

const back = () => {
  if (router.options.history.state.back === null) {
    void router.push({ name: ROUTE.dailyPlan });
    return;
  }
  router.back();
};
</script>

<template>
  <div class="panel-page">
    <header v-if="!ownHeader" class="header">
      <v-btn
        variant="text"
        prepend-icon="mdi-arrow-left"
        data-testid="panel-back"
        @click="back"
      >
        {{ t('extensionPanel.back') }}
      </v-btn>
      <div class="titles">
        <h1 ref="heading" tabindex="-1" class="text-title-large">
          {{ resolved ? panelTitle : missingTitle }}
        </h1>
        <span v-if="resolved" class="caption">{{ extensionId }}</span>
      </div>
    </header>

    <div v-if="resolved" class="panel-area">
      <PanelHost
        ref="host"
        :key="resolved.panel.key"
        :panel="resolved.panel"
        :commands="resolved.commands"
        :open-props="panelProps.get(key)"
        :context="context"
        :label="ownHeader ? panelTitle : undefined"
      />
    </div>
    <div
      v-else-if="clientState?.status === 'loading'"
      class="panel-loading"
      data-testid="panel-loading"
    >
      <v-progress-circular
        indeterminate
        :aria-label="t('extensionPanel.loading')"
      />
    </div>
    <v-empty-state
      v-else-if="clientState?.status === 'failed'"
      icon="mdi-alert-circle-outline"
      :text="clientState.error ?? ''"
      data-testid="panel-client-failed"
    >
      <template #actions>
        <v-btn
          variant="tonal"
          color="primary"
          data-testid="panel-client-retry"
          @click="clients.reload(extensionId)"
        >
          {{ t('extensionPanel.retry') }}
        </v-btn>
      </template>
    </v-empty-state>
    <v-empty-state
      v-else
      icon="mdi-puzzle-outline"
      :text="t('extensionPanel.unavailable.text')"
      data-testid="panel-unavailable"
    >
      <template #actions>
        <v-btn variant="tonal" color="primary" :to="{ name: ROUTE.dailyPlan }">
          {{ t('extensionPanel.unavailable.toPlan') }}
        </v-btn>
      </template>
    </v-empty-state>
  </div>
</template>

<style scoped>
.panel-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  flex: none;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}

.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.caption {
  font-size: 0.8125rem;
  color: rgb(var(--v-theme-on-surface-variant));
}

.panel-area {
  flex: 1 1 0;
  min-height: 0;
}

.panel-loading {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
}
</style>
