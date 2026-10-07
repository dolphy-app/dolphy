<script setup lang="ts">
import { onErrorCaptured, provide, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PANEL_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-api';
import { useExtensionCommands } from '@/features/extension-commands';
import type { ClientPanel } from '@/shared/lib/extension-clients.ts';
import { provideExtensionContext } from '@/shared/lib/extension-context.ts';

const props = withDefaults(
  defineProps<{
    panel: ClientPanel;
    /** Серверные команды этого расширения, которые панель вправе вызывать. */
    commands: ReadonlySet<string>;
    /** Свойства из `openPanel(id, props)`; повторный `openPanel` обновляет их на месте. */
    openProps?: JsonValue;
    /** Окружение панели: курс в фокусе; смена доходит без пересоздания. */
    context: { courseId: string | null };
  }>(),
  { openProps: undefined },
);

const { t } = useI18n();
const { runner } = useExtensionCommands();
provideExtensionContext(props.panel.extensionId);

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

const failure = ref<string | null>(null);
// повтор после сбоя рендера создаёт компонент заново
const attempt = ref(0);

const retry = () => {
  failure.value = null;
  attempt.value += 1;
};

onErrorCaptured((error) => {
  console.error(
    { error, extensionId: props.panel.extensionId, panelId: props.panel.id },
    'extension panel failed',
  );
  failure.value = error instanceof Error ? error.message : String(error);
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
          @click="retry"
        >
          {{ t('extensionPanel.retry') }}
        </v-btn>
      </template>
    </v-alert>
    <component :is="panel.component" v-else :key="attempt" />
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
