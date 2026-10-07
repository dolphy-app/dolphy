<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useExtensionClients } from '@/shared/lib/extension-clients.ts';

const props = defineProps<{ extensionId: string }>();

const { t } = useI18n();
const clients = useExtensionClients();

const state = computed(() => clients.states.value.get(props.extensionId));
</script>

<template>
  <v-alert
    v-if="state?.status === 'failed'"
    type="warning"
    variant="tonal"
    density="compact"
    class="mt-3"
    :title="t('settings.extensions.clientFailed.title')"
    data-testid="client-failed"
  >
    <p v-if="state.error !== null" class="message text-body-small">
      {{ state.error }}
    </p>
  </v-alert>
</template>

<style scoped>
.message {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
</style>
