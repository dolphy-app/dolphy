<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Diagnostic } from '@dolphy-app/engine-contract';
import { useCourseScope } from '@/features/course-scope';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { isFinalFailure } from '../lib/failure.ts';
import { describeFailureText } from '../model/transfers.ts';
import type { TransferPhase } from '../model/transfers.ts';
import { useExtensionTransfers } from '../model/use-transfers.ts';

const { t } = useI18n();
const transfers = useExtensionTransfers();
const scope = useCourseScope();
const extensionText = useExtensionText();

const phase = transfers.phase;
const view = <K extends TransferPhase['kind']>(kind: K) =>
  computed(() => {
    const current = phase.value;
    return current.kind === kind
      ? (current as Extract<TransferPhase, { kind: K }>)
      : null;
  });
const working = view('working');
const preview = view('preview');
const choosing = view('choose-course');

// --- возврат фокуса: диалог открыт действием пользователя, после закрытия фокус возвращается ---
let trigger: HTMLElement | null = null;
watch(
  () => phase.value.kind === 'idle',
  async (idle) => {
    // срабатывает только при смене `idle`: начало и конец всей цепочки диалогов
    if (!idle) {
      trigger =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    }
    if (idle) {
      await nextTick();
      if (trigger?.isConnected) trigger.focus();
      trigger = null;
    }
  },
);

// --- занятость: короткий выбор файла не мигает окном ожидания ---
const WORKING_DELAY_MS = 400;
const workingShown = ref(false);
let workingTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  working,
  (current) => {
    clearTimeout(workingTimer);
    if (current === null) {
      workingShown.value = false;
      return;
    }
    workingTimer = setTimeout(() => {
      workingShown.value = true;
    }, WORKING_DELAY_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(workingTimer));

const workingTitle = computed(() => {
  const current = working.value;
  return current === null
    ? ''
    : t(`transfers.working.${current.action}`, { title: current.title });
});

// --- сводка импорта ---
const importTitle = computed(() => {
  const current = preview.value;
  return current === null
    ? ''
    : t('transfers.import.title', {
        title: extensionText.of(
          current.importer.title,
          current.importer.extensionId,
        ),
      });
});
const failureMessage = computed(() => {
  const failure = preview.value?.failure;
  return failure ? describeFailureText(t, failure) : null;
});
// после отказа перезагрузки показываются её диагностики, иначе — диагностики сводки
const shownDiagnostics = computed<Diagnostic[]>(() => {
  const current = preview.value;
  if (current === null) return [];
  return current.failure !== null && current.failure.diagnostics.length > 0
    ? current.failure.diagnostics
    : current.preview.diagnostics;
});
const summary = computed(() => {
  const current = preview.value;
  if (current === null) return null;
  return current.failure?.summary ?? current.preview.summary;
});
const hiddenCount = computed(() => {
  const total = (summary.value?.errors ?? 0) + (summary.value?.warnings ?? 0);
  return Math.max(0, total - shownDiagnostics.value.length);
});
const hasErrors = computed(() => (summary.value?.errors ?? 0) > 0);
const noCourses = computed(
  () =>
    preview.value !== null &&
    preview.value.preview.counts.courses === 0 &&
    !hasErrors.value,
);
const canImport = computed(() => {
  const current = preview.value;
  if (current === null || current.preview.importId === null) return false;
  return current.failure === null || !isFinalFailure(current.failure);
});
const locationOf = ({ path, line }: Diagnostic) => {
  if (path === undefined) return '';
  return line === undefined ? path : `${path}:${line}`;
};

const previewOpen = computed({
  get: () => preview.value !== null,
  set: (value: boolean) => {
    if (!value) void transfers.cancelImport();
  },
});

// --- выбор курса для экспорта ---
const courseId = ref<string | null>(null);
watch(choosing, (current) => {
  if (current === null) return;
  const { courses, activeId } = scope;
  // по умолчанию курс в фокусе, иначе первый
  courseId.value =
    courses.value.find(({ id }) => id === activeId.value)?.id ??
    courses.value[0]?.id ??
    null;
});
const exportTitle = computed(() => {
  const current = choosing.value;
  return current === null
    ? ''
    : t('transfers.export.title', {
        title: extensionText.of(
          current.exporter.title,
          current.exporter.extensionId,
        ),
      });
});
const chooseOpen = computed({
  get: () => choosing.value !== null,
  set: (value: boolean) => {
    if (!value) transfers.cancelExport();
  },
});
const exportCourse = () => {
  if (courseId.value !== null) void transfers.exportCourse(courseId.value);
};
</script>

<template>
  <v-dialog
    :model-value="workingShown"
    persistent
    max-width="420"
    aria-labelledby="transfer-working-title"
  >
    <v-card class="pa-2" data-testid="transfer-working">
      <v-card-text role="status" aria-live="polite">
        <p id="transfer-working-title" class="text-body-large mb-2">
          {{ workingTitle }}
        </p>
        <p class="text-body-small text-medium-emphasis mb-4">
          {{ t('transfers.working.hint') }}
        </p>
        <v-progress-linear indeterminate rounded :aria-label="workingTitle" />
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="previewOpen"
    max-width="640"
    scrollable
    :persistent="preview?.committing === true"
    aria-labelledby="transfer-import-title"
  >
    <v-card
      v-if="preview"
      class="pa-2"
      :aria-busy="preview.committing"
      data-testid="import-dialog"
    >
      <v-card-title id="transfer-import-title" class="text-wrap">
        {{ importTitle }}
      </v-card-title>
      <v-card-text>
        <p class="file text-body-medium text-medium-emphasis mb-4">
          {{ t('transfers.import.file', { name: preview.fileName }) }}
        </p>

        <dl class="counts mb-4" data-testid="import-counts">
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">{{ t('transfers.import.courses') }}</dt>
            <dd class="text-headline-small font-weight-bold">
              {{ preview.preview.counts.courses }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">{{ t('transfers.import.lessons') }}</dt>
            <dd class="text-headline-small font-weight-bold">
              {{ preview.preview.counts.lessons }}
            </dd>
          </div>
          <div class="d-flex flex-column-reverse">
            <dt class="overline-label">
              {{ t('transfers.import.exercises') }}
            </dt>
            <dd class="text-headline-small font-weight-bold">
              {{ preview.preview.counts.exercises }}
            </dd>
          </div>
        </dl>

        <v-alert
          v-if="hasErrors"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          :text="t('transfers.import.hasErrors')"
        />
        <v-alert
          v-else-if="noCourses"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
          :text="t('transfers.import.noCourses')"
        />
        <v-alert
          v-else-if="preview.preview.replaces"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-testid="import-replaces"
          :text="t('transfers.import.replaces', { path: preview.preview.path })"
        />
        <p v-else class="path text-body-small text-medium-emphasis mb-4">
          {{ t('transfers.import.target', { path: preview.preview.path }) }}
        </p>

        <v-alert
          v-if="failureMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-testid="import-failure"
          :text="failureMessage"
        />

        <section v-if="shownDiagnostics.length > 0">
          <h4 class="text-title-medium font-weight-bold mb-2">
            {{ t('transfers.import.diagnostics') }}
          </h4>
          <div class="d-flex flex-wrap ga-2 mb-2">
            <v-chip
              v-if="(summary?.errors ?? 0) > 0"
              size="small"
              color="error"
            >
              {{ t('transfers.import.errors', { n: summary?.errors }) }}
            </v-chip>
            <v-chip
              v-if="(summary?.warnings ?? 0) > 0"
              size="small"
              color="warning"
            >
              {{ t('transfers.import.warnings', { n: summary?.warnings }) }}
            </v-chip>
          </div>
          <ul class="diagnostics" data-testid="import-diagnostics">
            <li
              v-for="(item, index) in shownDiagnostics"
              :key="index"
              class="d-flex ga-2 align-start"
            >
              <v-icon
                :icon="
                  item.severity === 'error'
                    ? 'mdi-alert-circle-outline'
                    : 'mdi-alert-outline'
                "
                :color="item.severity === 'error' ? 'error' : 'warning'"
                size="small"
                class="mt-1"
                :aria-label="
                  t(
                    item.severity === 'error'
                      ? 'transfers.import.severity.error'
                      : 'transfers.import.severity.warning',
                  )
                "
                role="img"
              />
              <span class="diagnostic text-body-medium">
                {{ item.message }}
                <span
                  v-if="locationOf(item) !== ''"
                  class="path text-body-small text-medium-emphasis"
                >
                  {{ locationOf(item) }}
                </span>
              </span>
            </li>
          </ul>
          <p
            v-if="hiddenCount > 0"
            class="text-body-small text-medium-emphasis mt-2"
          >
            {{
              t('transfers.import.moreHidden', {
                n: shownDiagnostics.length,
                errors: summary?.errors,
                warnings: summary?.warnings,
              })
            }}
          </p>
        </section>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="preview.committing"
          data-testid="import-cancel"
          @click="transfers.cancelImport()"
        >
          {{
            preview.preview.importId === null
              ? t('transfers.import.close')
              : t('transfers.import.cancel')
          }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          :disabled="!canImport"
          :loading="preview.committing"
          data-testid="import-submit"
          @click="transfers.commitImport()"
        >
          {{ t('transfers.import.submit') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="chooseOpen"
    max-width="480"
    scrollable
    aria-labelledby="transfer-export-title"
  >
    <v-card v-if="choosing" class="pa-2" data-testid="export-dialog">
      <v-card-title id="transfer-export-title" class="text-wrap">
        {{ exportTitle }}
      </v-card-title>
      <v-card-text>
        <v-radio-group
          v-if="scope.courses.value.length > 0"
          v-model="courseId"
          :label="t('transfers.export.choose')"
          hide-details
        >
          <v-radio
            v-for="course in scope.courses.value"
            :key="course.id"
            :value="course.id"
            :label="course.name"
          />
        </v-radio-group>
        <p v-else class="text-body-medium text-medium-emphasis">
          {{ t('transfers.export.noCourses') }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          data-testid="export-cancel"
          @click="transfers.cancelExport()"
        >
          {{ t('transfers.export.cancel') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          :disabled="courseId === null"
          data-testid="export-submit"
          @click="exportCourse"
        >
          {{ t('transfers.export.submit') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.counts {
  display: flex;
  gap: 2.5rem;
}

.file,
.path,
.diagnostic {
  overflow-wrap: anywhere;
}

.path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.diagnostic .path {
  display: block;
}

.diagnostics {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
