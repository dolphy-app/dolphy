<script setup lang="ts">
import {
  computed,
  onErrorCaptured,
  provide,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { PANEL_HANDLE_KEY, isMountable } from '@dolphy-app/extension-api';
import type { JsonValue, PanelHandle } from '@dolphy-app/extension-api';
import { useExtensionCommands } from '@/features/extension-commands';
import type { ClientPanel } from '@/shared/lib/extension-clients.ts';
import { provideExtensionContext } from '@/shared/lib/extension-context.ts';
import MountableHost from '@/shared/ui/MountableHost.vue';

const props = withDefaults(
  defineProps<{
    panel: ClientPanel;
    /** Серверные команды этого расширения, которые панель вправе вызывать. */
    commands: ReadonlySet<string>;
    /** Свойства из `openPanel(id, props)`; повторный `openPanel` обновляет их на месте. */
    openProps?: JsonValue;
    /** Окружение панели: курс в фокусе; смена доходит без пересоздания. */
    context: { courseId: string | null };
    /** Название панели без шапки приложения: контейнер получает роль области, метку и принимает фокус. */
    label?: string;
  }>(),
  { openProps: undefined, label: undefined },
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

const mountable = computed(() =>
  isMountable(props.panel.component) ? props.panel.component : null,
);
const vueComponent = computed(() =>
  isMountable(props.panel.component) ? null : props.panel.component,
);
const mountProps = computed(() => ({
  panelId: props.panel.id,
  props: props.openProps,
  context: { courseId: context.courseId },
}));

const body = useTemplateRef<HTMLElement>('body');
defineExpose({ focus: () => body.value?.focus() });

const failure = ref<string | null>(null);
// повтор после сбоя рендера создаёт компонент заново
const attempt = ref(0);

const retry = () => {
  failure.value = null;
  attempt.value += 1;
};

const showFailure = (error: unknown) => {
  failure.value = error instanceof Error ? error.message : String(error);
};

onErrorCaptured((error) => {
  console.error(
    { error, extensionId: props.panel.extensionId, panelId: props.panel.id },
    'extension panel failed',
  );
  showFailure(error);
  return false;
});
</script>

<template>
  <div
    ref="body"
    class="panel-body"
    data-testid="extension-panel-body"
    :role="label === undefined ? undefined : 'region'"
    :aria-label="label"
    :tabindex="label === undefined ? undefined : -1"
  >
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
    <MountableHost
      v-else-if="mountable !== null"
      :key="attempt"
      :extension-id="panel.extensionId"
      :mountable="mountable"
      :props="mountProps"
      :handle="handle"
      @error="showFailure"
    />
    <component
      :is="vueComponent"
      v-else-if="vueComponent !== null"
      :key="attempt"
    />
  </div>
</template>

<style scoped>
.panel-body {
  height: 100%;
  overflow: auto;
}

.panel-body:focus {
  outline: none;
}

.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
