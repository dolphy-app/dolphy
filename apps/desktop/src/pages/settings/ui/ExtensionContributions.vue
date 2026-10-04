<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ContributionTitlesDto,
  ExtensionContributesDto,
  ExtensionMessagesDto,
} from '@dolphy-app/engine-contract';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { EVENT_MESSAGE_KEYS } from '../lib/catalog.ts';
import {
  contributionGroups,
  hidesContributions,
  visibleValues,
} from '../model/extensions.ts';

const props = defineProps<{
  contributes: ExtensionContributesDto;
  titles: ContributionTitlesDto;
  /** Название расширения: единственная тема с таким же названием не повторяется. */
  name: string | null;
  /** Таблицы переводов установленного расширения: названия с `%ключ%` подставляются на языке окна. Каталог отдаёт уже английский текст. */
  messages?: ExtensionMessagesDto;
}>();

const { t, te } = useI18n();
const extensionText = useExtensionText();

const localizedTitles = computed<ContributionTitlesDto>(() =>
  Object.fromEntries(
    Object.entries(props.titles).map(([point, titles]) => [
      point,
      Object.fromEntries(
        Object.entries(titles).map(([id, title]) => [
          id,
          extensionText.withTables(title, props.messages),
        ]),
      ),
    ]),
  ),
);
const localizedName = computed(() =>
  props.name === null
    ? null
    : extensionText.withTables(props.name, props.messages),
);

// длинная группа (до 64 команд) свёрнута до первых значений; раскрытие — по точке вклада
const expanded = reactive<Record<string, boolean>>({});

const eventLabel = (name: string) => {
  const key = EVENT_MESSAGE_KEYS[name];
  const path = `settings.extensions.events.${key}`;
  return key !== undefined && te(path) ? t(path) : name;
};

const hidden = computed(() =>
  hidesContributions(
    props.contributes,
    localizedTitles.value,
    localizedName.value,
  ),
);
const groups = computed(() =>
  contributionGroups(props.contributes, localizedTitles.value, eventLabel),
);
</script>

<template>
  <div v-if="!hidden">
    <div
      v-for="group in groups"
      :key="group.point"
      class="d-flex flex-wrap align-center ga-2 mt-3"
      :data-point="group.point"
    >
      <span class="text-body-small text-medium-emphasis">
        {{ t(`settings.extensions.points.${group.point}`) }}:
      </span>
      <ul class="types">
        <li
          v-for="item in visibleValues(
            group.items,
            expanded[group.point] === true,
          ).shown"
          :key="item.id"
        >
          <v-chip
            size="small"
            variant="tonal"
            :class="item.mono ? 'id' : 'label'"
            :title="item.label === item.id ? undefined : item.id"
          >
            {{ item.label }}
            <span v-if="item.duplicate" class="visually-hidden">
              ({{ item.id }})
            </span>
          </v-chip>
        </li>
      </ul>
      <v-btn
        v-if="visibleValues(group.items, false).hidden > 0"
        size="small"
        variant="text"
        color="primary"
        :aria-expanded="expanded[group.point] === true"
        :data-testid="`values-toggle-${group.point}`"
        @click="expanded[group.point] = expanded[group.point] !== true"
      >
        {{
          expanded[group.point] === true
            ? t('settings.extensions.fewerValues')
            : t('settings.extensions.moreValues', {
                n: visibleValues(group.items, false).hidden,
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

.types li {
  max-width: 100%;
  min-width: 0;
}

/* длинное название (до 60 знаков) переносится внутри чипа, а не уходит за край карточки */
.id,
.label {
  height: auto;
  max-width: 100%;
  min-height: 1.5rem;
  overflow-wrap: anywhere;
  white-space: normal;
}

.id :deep(.v-chip__content),
.label :deep(.v-chip__content) {
  padding-block: 0.25rem;
}

.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
