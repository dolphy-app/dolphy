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
import type { WidgetContributionDto } from '@dolphy-app/engine-contract';
import { WIDGET_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { JsonValue, WidgetHandle } from '@dolphy-app/extension-api';
import { useExtensionCommands } from '@/features/extension-commands';
import {
  importExtensionModule,
  loadExtensionComponent,
} from '@/shared/lib/extension-component.ts';
import type { LoadExtensionModule } from '@/shared/lib/extension-component.ts';

const props = withDefaults(
  defineProps<{
    widget: WidgetContributionDto;
    /** Команды этого расширения, которые виджет вправе вызывать. */
    commands: ReadonlySet<string>;
    /** Окружение виджета: курс в фокусе; смена доходит без пересоздания. */
    context: { courseId: string | null };
    loadModule?: LoadExtensionModule;
  }>(),
  { loadModule: importExtensionModule },
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

const handle: WidgetHandle = {
  widgetId: props.widget.id,
  context,
  call: async (commandId: string, args?: JsonValue) => {
    if (!props.commands.has(commandId)) {
      throw new Error(`unknown command: ${commandId}`);
    }
    return runner.run(props.widget.extensionId, commandId, args, 'panel');
  },
};
provide(WIDGET_HANDLE_KEY, handle);

const component = shallowRef<Component | null>(null);
const failure = ref<string | null>(null);

const load = async () => {
  failure.value = null;
  component.value = null;
  try {
    component.value = await loadExtensionComponent(
      props.widget,
      'widgets',
      props.widget.id,
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
  <div class="widget-body" data-testid="extension-widget-body">
    <v-alert
      v-if="failure !== null"
      type="error"
      variant="tonal"
      density="compact"
      data-testid="extension-widget-failed"
    >
      {{ t('extensionWidgets.loadFailed') }}
      <div class="caption">{{ failure }}</div>
      <template #append>
        <v-btn
          size="small"
          variant="text"
          data-testid="extension-widget-retry"
          @click="load"
        >
          {{ t('extensionWidgets.retry') }}
        </v-btn>
      </template>
    </v-alert>
    <component :is="component" v-else-if="component !== null" />
  </div>
</template>

<style scoped>
.widget-body {
  padding: 0 1rem 1rem;
}

.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
