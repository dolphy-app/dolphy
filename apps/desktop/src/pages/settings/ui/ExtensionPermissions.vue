<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{ permissions: string[] }>();

const { t, te } = useI18n();

const permissionLabel = (name: string) => {
  const key = `settings.extensions.permissions.${name}`;
  return te(key) ? t(key) : name;
};
</script>

<template>
  <div>
    <div
      class="d-flex flex-wrap align-center ga-2 mt-3"
      data-point="permissions"
    >
      <span class="text-body-small text-medium-emphasis">
        {{ t('settings.extensions.permissionsTitle') }}:
      </span>
      <span v-if="permissions.length === 0" class="text-body-small">
        {{ t('settings.extensions.permissionsNone') }}
      </span>
      <ul v-else class="types">
        <li v-for="permission in permissions" :key="permission">
          <v-chip size="small" variant="tonal">
            {{ permissionLabel(permission) }}
          </v-chip>
        </li>
      </ul>
    </div>
    <p
      v-if="permissions.includes('network')"
      class="text-body-small text-medium-emphasis mt-1"
    >
      {{ t('settings.extensions.networkCaveat') }}
    </p>
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
</style>
