<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { DeprecationDto } from '@dolphy-app/engine-contract';
import { ROUTE } from '@/shared/config/routes.ts';

/**
 * Предупреждение «расширение устарело»: причина из `deprecated.json` каталога
 * (как есть), диапазон версий, если он ограничен, и альтернативы ссылками на их
 * страницы. Установка и обновление остаются доступными.
 */
defineProps<{ deprecation: DeprecationDto }>();
defineEmits<{ navigate: [id: string] }>();

const { t } = useI18n();
</script>

<template>
  <v-alert
    type="warning"
    variant="tonal"
    density="compact"
    class="mt-3"
    :title="t('settings.extensions.deprecated.title')"
    data-testid="deprecation"
  >
    <p class="reason">
      {{
        t('settings.extensions.deprecated.reason', {
          reason: deprecation.reason,
        })
      }}
    </p>
    <p v-if="deprecation.versions !== null" class="text-body-small mt-1">
      {{
        t('settings.extensions.deprecated.versions', {
          range: deprecation.versions,
        })
      }}
    </p>
    <div v-if="deprecation.alternatives.length > 0" class="mt-2">
      <p class="text-body-small">
        {{ t('settings.extensions.deprecated.alternatives') }}:
      </p>
      <ul class="alternatives">
        <li
          v-for="alternative in deprecation.alternatives"
          :key="alternative.id"
        >
          <router-link
            class="alternative"
            :to="{
              name: ROUTE.settingsExtensionDetails,
              params: { id: alternative.id },
            }"
            :aria-label="
              t('settings.extensions.deprecated.alternativeLabel', {
                name: alternative.name ?? alternative.id,
              })
            "
            :data-testid="`alternative-${alternative.id}`"
            @click="$emit('navigate', alternative.id)"
          >
            {{ alternative.name ?? alternative.id }}
          </router-link>
        </li>
      </ul>
    </div>
    <p class="text-body-small mt-2">
      {{ t('settings.extensions.deprecated.hint') }}
    </p>
  </v-alert>
</template>

<style scoped>
.reason {
  overflow-wrap: anywhere;
}

.alternatives {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  list-style: none;
  padding: 0;
}

.alternative {
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
}
</style>
