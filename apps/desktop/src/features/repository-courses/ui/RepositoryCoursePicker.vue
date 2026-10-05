<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RepositoryCourseDto } from '@dolphy-app/engine-contract';
import { blockedCourses, requiredBy } from '@/entities/repository';

const props = defineProps<{
  courses: readonly RepositoryCourseDto[];
  selected: ReadonlySet<string>;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  toggle: [id: string];
  selectAll: [];
  clear: [];
}>();

const { t } = useI18n();
const uid = useId();

const blocked = computed(() => blockedCourses(props.courses));
const holders = computed(() => requiredBy(props.courses, props.selected));
const titles = computed(
  () => new Map(props.courses.map(({ id, title }) => [id, title])),
);
const names = (ids: readonly string[]) =>
  ids.map((id) => titles.value.get(id) ?? id).join(', ');

const isLocked = (id: string) => holders.value.has(id);
const isOff = (id: string) =>
  props.disabled === true || blocked.value.has(id) || isLocked(id);

/** Единственная строка пояснения под курсом: причина недоступности важнее подсказок. */
const noteOf = (course: RepositoryCourseDto): string | null => {
  const block = blocked.value.get(course.id);
  if (block === 'errors') {
    return t('repositoryCourses.block.errors', { n: course.errors });
  }
  if (block === 'in-library') return t('repositoryCourses.block.inLibrary');
  if (block === 'requires-blocked') {
    return t('repositoryCourses.block.requiresBlocked');
  }
  const holding = holders.value.get(course.id);
  if (holding !== undefined) {
    return t('repositoryCourses.requiredBy', { names: names(holding) });
  }
  if (course.requires.length > 0) {
    return t('repositoryCourses.requires', { names: names(course.requires) });
  }
  return null;
};

const selectableCount = computed(
  () => props.courses.filter(({ id }) => !blocked.value.has(id)).length,
);
const noteId = (id: string) => `${uid}-note-${id}`;
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-2 mb-2">
      <span class="text-body-medium text-medium-emphasis" aria-live="polite">
        {{
          t('repositoryCourses.selected', {
            n: selected.size,
            total: selectableCount,
          })
        }}
      </span>
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        :disabled="disabled"
        @click="emit('selectAll')"
      >
        {{ t('repositoryCourses.selectAll') }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        :disabled="disabled"
        @click="emit('clear')"
      >
        {{ t('repositoryCourses.clear') }}
      </v-btn>
    </div>

    <ul class="courses" :aria-label="t('repositoryCourses.label')">
      <li
        v-for="course in courses"
        :key="course.id"
        class="course"
        :class="{ blocked: blocked.has(course.id) }"
      >
        <v-checkbox-btn
          :model-value="selected.has(course.id)"
          :disabled="isOff(course.id)"
          :aria-label="course.title"
          :aria-describedby="
            noteOf(course) === null ? undefined : noteId(course.id)
          "
          @update:model-value="emit('toggle', course.id)"
        />
        <div class="body">
          <div class="d-flex flex-wrap align-center ga-2">
            <span class="text-body-large font-weight-medium">
              {{ course.title }}
            </span>
            <v-chip v-if="course.installed" size="x-small" label>
              {{ t('repositoryCourses.installed') }}
            </v-chip>
            <v-chip
              v-if="course.warnings > 0 && course.errors === 0"
              size="x-small"
              label
              color="warning"
              variant="tonal"
            >
              {{ t('repositoryCourses.warnings', { n: course.warnings }) }}
            </v-chip>
          </div>
          <p class="text-body-small text-medium-emphasis">
            <span class="mono">{{ course.id }}</span>
            ·
            {{ t('repositoryCourses.lessons', { n: course.lessonCount }) }}
          </p>
          <p
            v-if="noteOf(course) !== null"
            :id="noteId(course.id)"
            class="text-body-small"
            :class="blocked.has(course.id) ? 'text-error' : ''"
          >
            {{ noteOf(course) }}
          </p>
          <p
            v-if="blocked.get(course.id) === 'errors' && course.messages[0]"
            class="text-body-small text-medium-emphasis message"
          >
            {{ course.messages[0] }}
          </p>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.courses {
  padding: 0;
  list-style: none;
  max-height: 22rem;
  overflow-y: auto;
}

.course {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.course + .course {
  border-top: 1px solid rgb(var(--v-theme-on-surface), 0.12);
}

.course :deep(.v-selection-control) {
  flex: none;
}

.body {
  flex: 1 1 0;
  min-width: 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.message {
  overflow-wrap: anywhere;
}
</style>
