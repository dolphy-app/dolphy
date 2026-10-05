<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  transferEntries,
  useExtensionTransfers,
} from '@/features/extension-transfers';
import { useContributions } from '@/shared/api/engine';
import { useExtensionText } from '@/shared/lib/extension-text.ts';

const { t } = useI18n();
const contributions = useContributions();
const transfers = useExtensionTransfers();
const extensionText = useExtensionText();

const entries = computed(() => transferEntries(contributions.value));
const empty = computed(
  () =>
    entries.value.importers.length === 0 &&
    entries.value.exporters.length === 0,
);
</script>

<template>
  <v-card class="pa-5 mb-6" data-testid="transfers-card">
    <h3 class="text-title-large font-weight-bold">
      {{ t('settings.library.transfers.title') }}
    </h3>
    <p class="text-body-medium text-medium-emphasis mt-1">
      {{ t('settings.library.transfers.description') }}
    </p>

    <p
      v-if="empty"
      class="text-body-medium text-medium-emphasis mt-4"
      data-testid="transfers-empty"
    >
      {{ t('settings.library.transfers.empty') }}
    </p>

    <template v-else>
      <section v-if="entries.importers.length > 0" class="mt-4">
        <h4 class="overline-label mb-2">
          {{ t('settings.library.transfers.importers') }}
        </h4>
        <ul class="entries">
          <li
            v-for="item in entries.importers"
            :key="`${item.extensionId}:${item.id}`"
            class="entry"
            data-testid="transfer-importer"
          >
            <div class="entry-text">
              <p class="text-body-large font-weight-medium">
                {{ extensionText.of(item.title, item.extensionId) }}
              </p>
              <p class="text-body-small text-medium-emphasis">
                <span class="id">{{ item.extensionId }}</span>
                ·
                {{
                  t('settings.library.transfers.accept', {
                    accept: item.accept.join(', '),
                  })
                }}
              </p>
            </div>
            <v-btn
              variant="tonal"
              color="primary"
              prepend-icon="mdi-file-import-outline"
              :disabled="transfers.busy.value"
              :aria-label="
                t('settings.library.transfers.importLabel', {
                  title: extensionText.of(item.title, item.extensionId),
                })
              "
              @click="transfers.startImport(item.extensionId, item.id)"
            >
              {{ t('settings.library.transfers.import') }}
            </v-btn>
          </li>
        </ul>
      </section>

      <section v-if="entries.exporters.length > 0" class="mt-4">
        <h4 class="overline-label mb-2">
          {{ t('settings.library.transfers.exporters') }}
        </h4>
        <ul class="entries">
          <li
            v-for="item in entries.exporters"
            :key="`${item.extensionId}:${item.id}`"
            class="entry"
            data-testid="transfer-exporter"
          >
            <div class="entry-text">
              <p class="text-body-large font-weight-medium">
                {{ extensionText.of(item.title, item.extensionId) }}
              </p>
              <p class="text-body-small text-medium-emphasis">
                <span class="id">{{ item.extensionId }}</span>
                ·
                {{ t(`settings.library.transfers.scope.${item.scope}`) }}
              </p>
            </div>
            <v-btn
              variant="tonal"
              color="primary"
              prepend-icon="mdi-file-export-outline"
              :disabled="transfers.busy.value"
              :aria-label="
                t('settings.library.transfers.exportLabel', {
                  title: extensionText.of(item.title, item.extensionId),
                })
              "
              @click="transfers.startExport(item.extensionId, item.id)"
            >
              {{ t('settings.library.transfers.export') }}
            </v-btn>
          </li>
        </ul>
      </section>
    </template>
  </v-card>
</template>

<style scoped>
.entries {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.entry {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.entry-text {
  flex: 1 1 14rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
