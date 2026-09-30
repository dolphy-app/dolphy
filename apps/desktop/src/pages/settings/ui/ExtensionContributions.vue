<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ExtensionContributesDto } from '@spirula-app/engine-contract';
import { contributionGroups } from '../model/extensions.ts';

defineProps<{ contributes: ExtensionContributesDto }>();

const { t } = useI18n();
</script>

<template>
  <div>
    <div
      v-for="group in contributionGroups(contributes)"
      :key="group.point"
      class="d-flex flex-wrap align-center ga-2 mt-3"
      :data-point="group.point"
    >
      <span class="text-body-small text-medium-emphasis">
        {{ t(`settings.extensions.points.${group.point}`) }}:
      </span>
      <ul class="types">
        <li v-for="value in group.values" :key="value">
          <v-chip size="small" variant="tonal" class="id">
            {{ value }}
          </v-chip>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
}

.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
</style>
