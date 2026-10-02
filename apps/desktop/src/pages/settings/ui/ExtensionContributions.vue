<script setup lang="ts">
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ExtensionContributesDto } from '@dolphy-app/engine-contract';
import { contributionGroups, visibleValues } from '../model/extensions.ts';

defineProps<{ contributes: ExtensionContributesDto }>();

const { t } = useI18n();

// длинная группа (до 64 команд) свёрнута до первых значений; раскрытие — по точке вклада
const expanded = reactive<Record<string, boolean>>({});
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
        <li
          v-for="value in visibleValues(group.values, expanded[group.point] === true).shown"
          :key="value"
        >
          <v-chip size="small" variant="tonal" class="id">
            {{ value }}
          </v-chip>
        </li>
      </ul>
      <v-btn
        v-if="visibleValues(group.values, false).hidden > 0"
        size="small"
        variant="text"
        :aria-expanded="expanded[group.point] === true"
        :data-testid="`values-toggle-${group.point}`"
        @click="expanded[group.point] = expanded[group.point] !== true"
      >
        {{
          expanded[group.point] === true
            ? t('settings.extensions.fewerValues')
            : t('settings.extensions.moreValues', {
                n: visibleValues(group.values, false).hidden,
              })
        }}
      </v-btn>
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
