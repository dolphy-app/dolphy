<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WidgetContributionDto } from '@dolphy-app/engine-contract';
import { useCourseScope } from '@/features/course-scope';
import { useContributions } from '@/shared/api/engine';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useExtensionWhen } from '@/shared/lib/extension-when.ts';
import WidgetHost from './WidgetHost.vue';
import { widgetsOf } from '../model/widgets.ts';

const props = defineProps<{
  /** Место, чьи виджеты показываются (`contributes.widgets[].slot`). */
  area: WidgetContributionDto['slot'];
}>();

const { t } = useI18n();
const contributions = useContributions();
const extensionText = useExtensionText();
const extensionWhen = useExtensionWhen();
const scope = useCourseScope();
const headingId = useId();

const items = computed(() =>
  widgetsOf(contributions.value, props.area, extensionWhen),
);
// курс в фокусе доходит до виджетов без их пересоздания
const context = computed(() => ({ courseId: scope.activeId.value }));
const titleOf = (widget: WidgetContributionDto) =>
  extensionText.of(widget.title, widget.extensionId);
</script>

<template>
  <section
    v-if="items.length > 0"
    class="extension-widgets"
    :aria-labelledby="headingId"
    data-testid="extension-widgets"
  >
    <h2 :id="headingId" class="section-title text-title-large font-weight-bold">
      {{ t('extensionWidgets.title') }}
    </h2>
    <div class="grid">
      <v-card
        v-for="item in items"
        :key="item.key"
        class="widget"
        data-testid="extension-widget"
        :data-widget-id="item.widget.id"
        :data-extension-id="item.widget.extensionId"
      >
        <v-card-item>
          <template #title>
            <h3 class="text-title-medium font-weight-bold widget-title">
              {{ titleOf(item.widget) }}
            </h3>
          </template>
          <template #subtitle>
            <span class="caption">{{ item.widget.extensionId }}</span>
          </template>
        </v-card-item>
        <WidgetHost
          :widget="item.widget"
          :commands="item.commands"
          :context="context"
        />
      </v-card>
    </div>
  </section>
</template>

<style scoped>
.extension-widgets {
  margin-top: 1.5rem;
}

.section-title {
  /* глобальный `h1..h6 { margin: 0 }` не слоёный и перебивает утилиты Vuetify */
  margin: 0 0 0.75rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 1rem;
  align-items: start;
}

.widget-title {
  overflow-wrap: anywhere;
  white-space: normal;
}

/* подзаголовок карточки Vuetify полупрозрачен: подпись с id расширения на нём не набирала контраст 4.5:1 (axe color-contrast) */
.widget :deep(.v-card-subtitle) {
  opacity: 1;
}

.caption {
  font-size: 0.8125rem;
  color: rgb(var(--v-theme-on-surface-variant));
  overflow-wrap: anywhere;
}
</style>
