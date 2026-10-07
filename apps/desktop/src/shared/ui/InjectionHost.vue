<script setup lang="ts">
import { onErrorCaptured, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { INJECTION_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { InjectionHandle } from '@dolphy-app/extension-api';
import type { ClientInjection } from '@/shared/lib/extension-clients.ts';

const props = defineProps<{
  item: ClientInjection;
  handle: InjectionHandle;
}>();

const { t } = useI18n();

provide(INJECTION_HANDLE_KEY, props.handle);

const failure = ref<string | null>(null);
// повтор после сбоя рендера создаёт компонент заново
const attempt = ref(0);

const retry = () => {
  failure.value = null;
  attempt.value += 1;
};

onErrorCaptured((error) => {
  console.error(
    {
      error,
      extensionId: props.item.extensionId,
      injectionId: props.item.id,
    },
    'extension injection failed',
  );
  failure.value = error instanceof Error ? error.message : String(error);
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
    {{ t('extensionInjection.failed', { extensionId: item.extensionId }) }}
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
  <component :is="item.component" v-else :key="attempt" />
</template>

<style scoped>
.caption {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}
</style>
