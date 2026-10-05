<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useInstallContext } from '../model/install.ts';

/** Подтверждение удаления расширения; `target` — какое (`null` — диалог закрыт). */
const props = defineProps<{ target: ExtensionInfoDto | null }>();
const emit = defineEmits<{ close: []; removed: [id: string] }>();

const { t } = useI18n();
const extensionText = useExtensionText();
const install = useInstallContext();
const removeData = ref(false);

// каждое открытие начинается без отметки «Удалить данные» и без прежней ошибки
watch(
  () => props.target,
  (target) => {
    if (target === null) return;
    install.removeError.value = null;
    removeData.value = false;
  },
);

const confirm = async () => {
  const target = props.target;
  if (target === null) return;
  if (await install.remove(target.id, removeData.value)) {
    emit('removed', target.id);
    emit('close');
  }
};

const close = () => {
  if (install.removing.value === null) emit('close');
};
</script>

<template>
  <v-dialog
    :model-value="target !== null"
    max-width="480"
    aria-labelledby="extension-remove-title"
    :persistent="install.removing.value !== null"
    @update:model-value="close"
  >
    <v-card v-if="target" class="pa-2">
      <v-card-title id="extension-remove-title" class="text-wrap">
        {{
          t('settings.extensions.remove.title', {
            name: extensionText.nameOf(target),
          })
        }}
      </v-card-title>
      <v-card-text>
        <p>{{ t('settings.extensions.remove.text') }}</p>
        <v-checkbox
          v-model="removeData"
          :label="t('settings.extensions.remove.removeData')"
          :hint="t('settings.extensions.remove.removeDataHint')"
          persistent-hint
          density="compact"
          color="error"
          :disabled="install.removing.value !== null"
          data-testid="remove-data"
        />
        <v-alert
          v-if="install.removeError.value"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ t('settings.extensions.remove.failed') }}:
          {{ install.removeError.value }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="install.removing.value !== null"
          @click="close"
        >
          {{ t('settings.extensions.remove.cancel') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="error"
          :loading="install.removing.value !== null"
          data-testid="remove-confirm"
          @click="confirm"
        >
          {{ t('settings.extensions.remove.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
