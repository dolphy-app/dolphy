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
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { instanceKeyOf, resolvePanel } from '../model/panel.ts';
import PanelHost from './PanelHost.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contributions = useContributions();
const extensionText = useExtensionText();
const { panelProps } = useExtensionCommands();
const scope = useCourseScope();
// курс в фокусе доходит до панели без её пересоздания
const context = computed(() => ({ courseId: scope.activeId.value }));

const extensionId = computed(() => String(route.params['extensionId']));
const panelId = computed(() => String(route.params['panelId']));
const key = computed(() => panelKey(extensionId.value, panelId.value));
const resolved = computed(() =>
  resolvePanel(contributions.value, extensionId.value, panelId.value),
);

const panelTitle = computed(() =>
  resolved.value === null
    ? ''
    : extensionText.of(
        resolved.value.panel.title,
        resolved.value.panel.extensionId,
      ),
);

const heading = useTemplateRef<HTMLElement>('heading');

// заголовок страницы получает фокус при входе
watch(
  key,
  async (_next, previous) => {
    if (previous !== undefined) panelProps.clear(previous);
    await nextTick();
    heading.value?.focus();
  },
  { immediate: true, flush: 'post' },
);
onBeforeUnmount(() => panelProps.clear(key.value));

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
    <header class="header">
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
          {{ resolved ? panelTitle : t('extensionPanel.unavailable.title') }}
        </h1>
        <span v-if="resolved" class="caption">{{ extensionId }}</span>
      </div>
    </header>

    <div v-if="resolved" class="panel-area">
      <PanelHost
        :key="instanceKeyOf(resolved.panel)"
        :panel="resolved.panel"
        :commands="resolved.commands"
        :open-props="panelProps.get(key)"
        :context="context"
      />
    </div>
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
</style>
