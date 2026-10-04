<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useCourseScope } from '@/features/course-scope';
import { panelKey, useExtensionCommands } from '@/features/extension-commands';
import { useCommandPalette } from '@/widgets/command-palette';
import { useContributions } from '@/shared/api/engine';
import { ROUTE } from '@/shared/config/routes.ts';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { frameUrlOf } from '@/shared/lib/frame-bridge.ts';
import type { PanelBinding } from '@/shared/lib/frame-bridge.ts';
import PanelFrame from '@/shared/ui/PanelFrame.vue';
import { frameKeyOf, resolvePanel } from '../model/panel.ts';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const contributions = useContributions();
const extensionText = useExtensionText();
const { runner, panelProps } = useExtensionCommands();
const palette = useCommandPalette();
const scope = useCourseScope();
// курс в фокусе доходит до рамки без её пересоздания
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

const binding = computed<PanelBinding | null>(() =>
  resolved.value === null
    ? null
    : {
        extensionId: resolved.value.panel.extensionId,
        commands: resolved.value.commands,
        invoke: (id, commandId, args) =>
          runner.run(id, commandId, args, 'panel'),
      },
);

const heading = useTemplateRef<HTMLElement>('heading');
const frameError = ref<string | null>(null);

// заголовок страницы получает фокус при входе: фокус в рамку не уходит молча
watch(
  key,
  async (_next, previous) => {
    if (previous !== undefined) panelProps.clear(previous);
    frameError.value = null;
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

    <v-alert
      v-if="resolved && frameError !== null"
      type="error"
      variant="tonal"
      density="compact"
      class="mx-4 mb-2 flex-none"
      data-testid="panel-load-failed"
    >
      {{ t('extensionPanel.loadFailed') }}
      <div class="caption">{{ frameError }}</div>
    </v-alert>

    <div v-if="resolved && binding" class="frame-area">
      <PanelFrame
        :key="frameKeyOf(resolved.panel)"
        :src="frameUrlOf(resolved.panel.rendererUrl)"
        :title="
          t('extensionPanel.frameTitle', {
            title: panelTitle,
            extension: resolved.panel.extensionId,
          })
        "
        :renderer-url="resolved.panel.rendererUrl"
        :panel-id="resolved.panel.id"
        :binding="binding"
        :panel-props="panelProps.get(key)"
        :context="context"
        @shortcut="palette.open()"
        @error="frameError = $event"
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

.frame-area {
  flex: 1 1 0;
  min-height: 0;
}
</style>
