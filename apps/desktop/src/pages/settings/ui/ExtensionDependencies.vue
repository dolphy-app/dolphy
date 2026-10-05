<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DependencyRow, DependencyStatus } from '../lib/dependencies.ts';

const props = defineProps<{ rows: DependencyRow[] }>();

interface StatusView {
  icon: string;
  color: string;
}

const STATUS_VIEW: Record<DependencyStatus, StatusView> = {
  ok: { icon: 'mdi-check-circle-outline', color: 'success' },
  installed: { icon: 'mdi-check-circle-outline', color: 'success' },
  missing: { icon: 'mdi-alert-circle-outline', color: 'warning' },
  disabled: { icon: 'mdi-pause-circle-outline', color: 'warning' },
  version: { icon: 'mdi-alert-circle-outline', color: 'warning' },
  unmet: { icon: 'mdi-alert-circle-outline', color: 'warning' },
};

const { t } = useI18n();

/** Под списком — подсказка, что зависимости ставятся вручную: только когда в каталоге чего-то не хватает. */
const needsManualInstall = computed(() =>
  props.rows.some(({ status }) => status === 'missing' || status === 'version'),
);
</script>

<template>
  <div v-if="rows.length > 0" class="mt-3" data-point="dependencies">
    <div class="d-flex flex-wrap align-center ga-2">
      <span class="text-body-small text-medium-emphasis">
        {{ t('settings.extensions.dependencies.title') }}:
      </span>
      <ul class="deps">
        <li
          v-for="row in rows"
          :key="row.id"
          :data-dependency="row.id"
          :data-status="row.status ?? undefined"
        >
          <v-chip
            size="small"
            variant="tonal"
            :color="
              row.status === null ? undefined : STATUS_VIEW[row.status].color
            "
            :prepend-icon="
              row.status === null ? undefined : STATUS_VIEW[row.status].icon
            "
          >
            <span class="id">{{ row.id }}</span>
            <span v-if="row.range !== null" class="id ms-1">{{
              row.range
            }}</span>
            <span v-if="row.status !== null" class="ms-2">
              {{ t(`settings.extensions.dependencies.status.${row.status}`) }}
            </span>
          </v-chip>
        </li>
      </ul>
    </div>
    <p
      v-if="needsManualInstall"
      class="text-body-small text-medium-emphasis mt-1"
      data-testid="dependencies-hint"
    >
      {{ t('settings.extensions.dependencies.hint') }}
    </p>
  </div>
</template>

<style scoped>
.deps {
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
