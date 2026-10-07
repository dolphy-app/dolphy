<script setup lang="ts">
import {
  onErrorCaptured,
  provide,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PanelContributionDto } from '@dolphy-app/engine-contract';
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-api';
import { useExtensionCommands } from '@/features/extension-commands';
import {
  importExtensionModule,
  loadExtensionComponent,
} from '@/shared/lib/extension-component.ts';
import type { LoadExtensionModule } from '@/shared/lib/extension-component.ts';

const props = withDefaults(
  defineProps<{
    panel: PanelContributionDto;
    /** Команды этого расширения, которые панель вправе вызывать. */
    commands: ReadonlySet<string>;
    /** Свойства из `openPanel(id, props)`; повторный `openPanel` обновляет их на месте. */
    openProps?: JsonValue;
    /** Окружение панели: курс в фокусе; смена доходит без пересоздания. */
    context: { courseId: string | null };
    loadModule?: LoadExtensionModule;
  }>(),
  { openProps: undefined, loadModule: importExtensionModule },
);

const { t } = useI18n();
const { runner } = useExtensionCommands();

const context = reactive({ courseId: props.context.courseId });
watch(
  () => props.context.courseId,
  (courseId) => {
    context.courseId = courseId;
  },
);

const handle: PanelHandle = {
  panelId: props.panel.id,
  get props() {
    return props.openProps;
  },
  context,
  call: async (commandId, args) => {
    if (!props.commands.has(commandId)) {
      throw new Error(`unknown command: ${commandId}`);
    }
    return runner.run(props.panel.extensionId, commandId, args, 'panel');
  },
};
provide(PANEL_HANDLE_KEY, handle);

const component = shallowRef<Component | null>(null);
const failure = ref<string | null>(null);

const load = async () => {
  failure.value = null;
  component.value = null;
  try {
    component.value = await loadExtensionComponent(
      props.panel,
      'panels',
      props.panel.id,
      props.loadModule,
    );
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
};
void load();

onErrorCaptured((error) => {
  failure.value = error instanceof Error ? error.message : String(error);
  component.value = null;
  return false;
});
</script>

<template>
  <div class="panel-body" data-testid="extension-panel-body">
    <v-alert
      v-if="failure !== null"
      type="error"
      variant="tonal"
      density="compact"
      class="mx-4 mb-2"
      data-testid="panel-load-failed"
    >
      {{ t('extensionPanel.loadFailed') }}
      <div class="caption">{{ failure }}</div>
      <template #append>
        <v-btn
          size="small"
          variant="text"
          data-testid="panel-retry"
          @click="load"
        >
          {{ t('extensionPanel.retry') }}
        </v-btn>
      </template>
    </v-alert>
    <component :is="component" v-else-if="component !== null" />
  </div>
</template>

<style scoped>
.panel-body {
  height: 100%;
  overflow: auto;
}

.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
