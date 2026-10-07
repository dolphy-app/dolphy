<script setup lang="ts">
import { computed, onErrorCaptured, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { INJECTION_HANDLE_KEY, isMountable } from '@dolphy-app/extension-api';
import type { InjectionHandle } from '@dolphy-app/extension-api';
import type { ExtensionComponent } from '@/shared/lib/extension-client-registrations.ts';
import { provideExtensionContext } from '@/shared/lib/extension-context.ts';
import MountableHost from './MountableHost.vue';

const props = defineProps<{
  extensionId: string;
  /** Id вставки или `mountAt`. */
  injectionId: string;
  component: ExtensionComponent;
  componentProps?: Readonly<Record<string, unknown>>;
  handle: InjectionHandle;
}>();

const { t } = useI18n();

provideExtensionContext(props.extensionId);
provide(INJECTION_HANDLE_KEY, props.handle);

const mountable = computed(() =>
  isMountable(props.component) ? props.component : null,
);
const vueComponent = computed(() =>
  isMountable(props.component) ? null : props.component,
);
const mountProps = computed(() => ({
  target: props.handle.target,
  position: props.handle.position,
}));

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
    {
      error,
      extensionId: props.extensionId,
      injectionId: props.injectionId,
    },
    'extension injection failed',
  );
  showFailure(error);
  return false;
});
</script>

<template>
  <v-alert
    v-if="failure !== null"
    type="error"
    variant="tonal"
    density="compact"
    data-testid="extension-injection-failed"
  >
    {{ t('extensionInjection.failed', { extensionId }) }}
    <div class="caption">{{ failure }}</div>
    <template #append>
      <v-btn
        size="small"
        variant="text"
        data-testid="extension-injection-retry"
        @click="retry"
      >
        {{ t('common.retry') }}
      </v-btn>
    </template>
  </v-alert>
  <MountableHost
    v-else-if="mountable !== null"
    :key="attempt"
    :extension-id="extensionId"
    :mountable="mountable"
    :props="mountProps"
    :handle="handle"
    @error="showFailure"
  />
  <component
    :is="vueComponent"
    v-else-if="vueComponent !== null"
    :key="attempt"
    v-bind="componentProps"
  />
</template>

<style scoped>
.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
