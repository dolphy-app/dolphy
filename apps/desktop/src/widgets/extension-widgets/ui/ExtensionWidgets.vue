<script setup lang="ts">
import { computed, reactive, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WidgetContributionDto } from '@dolphy-app/engine-contract';
import { useCourseScope } from '@/features/course-scope';
import { useExtensionCommands } from '@/features/extension-commands';
import { useContributions } from '@/shared/api/engine';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useExtensionWhen } from '@/shared/lib/extension-when.ts';
import { frameUrlOf } from '@/shared/lib/frame-bridge.ts';
import type { PanelBinding } from '@/shared/lib/frame-bridge.ts';
import WidgetFrame from '@/shared/ui/WidgetFrame.vue';
import { useCommandPalette } from '@/widgets/command-palette';
import { widgetsOf } from '../model/widgets.ts';

const props = defineProps<{
  /** Место, чьи виджеты показываются (`contributes.widgets[].slot`). */
  area: WidgetContributionDto['slot'];
}>();

const { t } = useI18n();
const contributions = useContributions();
const extensionText = useExtensionText();
const extensionWhen = useExtensionWhen();
const { runner } = useExtensionCommands();
const scope = useCourseScope();
const palette = useCommandPalette();
const headingId = useId();

const items = computed(() => widgetsOf(contributions.value, props.area, extensionWhen));
// курс в фокусе доходит до рамок без их пересоздания
const context = computed(() => ({ courseId: scope.activeId.value }));
// ошибка загрузки рамки по ключу рамки: новая ревизия начинает с чистого листа
const failures = reactive(new Map<string, string>());

const bindingOf = (
  widget: WidgetContributionDto,
  commands: ReadonlySet<string>,
) =>
  ({
    extensionId: widget.extensionId,
    commands,
    invoke: (id, commandId, args) => runner.run(id, commandId, args, 'panel'),
  }) satisfies PanelBinding;

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
        <v-alert
          v-if="failures.has(item.key)"
          type="error"
          variant="tonal"
          density="compact"
          class="mx-4 mb-2"
          data-testid="extension-widget-failed"
        >
          {{ t('extensionWidgets.loadFailed') }}
          <div class="caption">{{ failures.get(item.key) }}</div>
        </v-alert>
        <div class="frame-area">
          <WidgetFrame
            :src="frameUrlOf(item.widget.rendererUrl)"
            :title="
              t('extensionWidgets.frameTitle', {
                title: titleOf(item.widget),
                extension: item.widget.extensionId,
              })
            "
            :renderer-url="item.widget.rendererUrl"
            :widget-id="item.widget.id"
            :binding="bindingOf(item.widget, item.commands)"
            :min-height="item.widget.minHeight"
            :max-height="item.widget.maxHeight"
            :context="context"
            @shortcut="palette.open()"
            @error="failures.set(item.key, $event)"
          />
        </div>
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

.caption {
  font-size: 0.8125rem;
  color: rgb(var(--v-theme-on-surface-variant));
  overflow-wrap: anywhere;
}

.frame-area {
  padding: 0 1rem 1rem;
}
</style>
