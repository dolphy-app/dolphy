<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useContributions, useEngine } from '@/shared/api/engine';
import { useExtensionText } from '@/shared/lib/extension-text.ts';
import { useGradePolicySetting } from '../model/grade-policy.ts';
import { useLearningSettings } from '../model/learning.ts';
import type { LearningForm } from '../model/learning.ts';
import SectionHeader from './SectionHeader.vue';
import SettingsRow from './SettingsRow.vue';

type NumericField = {
  [K in keyof LearningForm]: LearningForm[K] extends number ? K : never;
}[keyof LearningForm];

const { form, busy, error, isDirty, save, revert, resetToDefaults } =
  useLearningSettings(useEngine());
const contributions = useContributions();
const gradePolicy = useGradePolicySetting(
  useEngine(),
  () => contributions.value.gradePolicies,
);
const { t } = useI18n();
const extensionText = useExtensionText();
const confirmReset = ref(false);
const gradePolicyItems = computed(() =>
  gradePolicy.options.value.map(({ id, label, extensionId }) => ({
    value: id,
    title:
      label === null
        ? t('settings.learning.gradePolicy.passAtN.title')
        : extensionText.of(label, extensionId ?? ''),
    subtitle: extensionId ?? t('settings.learning.gradePolicy.builtin'),
  })),
);
const revertDisabled = computed(() => !isDirty.value || busy.value);

const setNumber = (field: NumericField, value: number | null) => {
  if (form.value && value !== null) form.value[field] = value;
};

const reset = async () => {
  confirmReset.value = false;
  await resetToDefaults();
};
</script>

<template>
  <section>
    <SectionHeader
      :title="t('settings.learning.title')"
      :subtitle="t('settings.learning.subtitle')"
    />

    <v-alert v-if="error" type="error" variant="tonal" class="mb-6">
      {{ error }}
    </v-alert>

    <v-alert
      v-if="gradePolicy.error.value"
      type="error"
      variant="tonal"
      class="mb-6"
    >
      {{ gradePolicy.error.value }}
    </v-alert>

    <v-progress-linear v-if="!form" indeterminate rounded />

    <template v-else>
      <div class="d-flex flex-column ga-3">
        <p class="overline-label mt-2">
          {{ t('settings.learning.groups.plan') }}
        </p>

        <SettingsRow
          :title="t('settings.learning.targetRetention.title')"
          :description="t('settings.learning.targetRetention.description')"
        >
          <v-slider
            :model-value="form.targetRetentionPercent"
            min="70"
            max="99"
            step="1"
            hide-details
            color="primary"
            width="200"
            :aria-label="t('settings.learning.targetRetention.title')"
            @update:model-value="setNumber('targetRetentionPercent', $event)"
          />
          <span class="value text-title-medium font-weight-bold">
            {{ form.targetRetentionPercent }}%
          </span>
        </SettingsRow>

        <SettingsRow
          :title="t('settings.learning.newFraction.title')"
          :description="t('settings.learning.newFraction.description')"
        >
          <v-slider
            :model-value="form.minNewFractionPercent"
            min="0"
            max="100"
            step="5"
            hide-details
            color="primary"
            width="200"
            :aria-label="t('settings.learning.newFraction.title')"
            @update:model-value="setNumber('minNewFractionPercent', $event)"
          />
          <span class="value text-title-medium font-weight-bold">
            {{ form.minNewFractionPercent }}%
          </span>
        </SettingsRow>

        <SettingsRow
          :title="t('settings.learning.sameCourseRun.title')"
          :description="t('settings.learning.sameCourseRun.description')"
        >
          <v-number-input
            :model-value="form.maxSameCourseRun"
            :min="1"
            :max="10"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.sameCourseRun.title')"
            @update:model-value="setNumber('maxSameCourseRun', $event)"
          />
        </SettingsRow>

        <SettingsRow
          :title="t('settings.learning.tagDistance.title')"
          :description="t('settings.learning.tagDistance.description')"
        >
          <v-number-input
            :model-value="form.minTagDistance"
            :min="0"
            :max="10"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.tagDistance.title')"
            @update:model-value="setNumber('minTagDistance', $event)"
          />
        </SettingsRow>

        <p class="overline-label mt-4">
          {{ t('settings.learning.groups.sessions') }}
        </p>

        <SettingsRow
          :title="t('settings.learning.batchSize.title')"
          :description="t('settings.learning.batchSize.description')"
        >
          <v-number-input
            :model-value="form.batchSize"
            :min="1"
            :max="200"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.batchSize.title')"
            @update:model-value="setNumber('batchSize', $event)"
          />
        </SettingsRow>

        <SettingsRow
          :title="t('settings.learning.lessonsInProgress.title')"
          :description="t('settings.learning.lessonsInProgress.description')"
        >
          <v-number-input
            :model-value="form.maxLessonsInProgress"
            :min="1"
            :max="50"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.lessonsInProgress.title')"
            @update:model-value="setNumber('maxLessonsInProgress', $event)"
          />
        </SettingsRow>

        <p class="overline-label mt-4">
          {{ t('settings.learning.groups.remediation') }}
        </p>

        <SettingsRow
          :title="t('settings.learning.failThreshold.title')"
          :description="t('settings.learning.failThreshold.description')"
        >
          <v-number-input
            :model-value="form.failThreshold"
            :min="1"
            :max="10"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.failThreshold.title')"
            @update:model-value="setNumber('failThreshold', $event)"
          />
        </SettingsRow>

        <SettingsRow
          :title="t('settings.learning.remediationItems.title')"
          :description="t('settings.learning.remediationItems.description')"
        >
          <v-number-input
            :model-value="form.remediationMaxItems"
            :min="1"
            :max="20"
            width="140"
            density="compact"
            variant="outlined"
            hide-details
            :aria-label="t('settings.learning.remediationItems.title')"
            @update:model-value="setNumber('remediationMaxItems', $event)"
          />
        </SettingsRow>

        <p class="overline-label mt-4">
          {{ t('settings.learning.groups.grading') }}
        </p>

        <SettingsRow
          :title="t('settings.learning.gradePolicy.title')"
          :description="t('settings.learning.gradePolicy.description')"
        >
          <v-select
            class="grade-policy-select"
            :model-value="gradePolicy.effective.value"
            :items="gradePolicyItems"
            :disabled="gradePolicy.busy.value"
            :aria-label="t('settings.learning.gradePolicy.title')"
            variant="outlined"
            density="comfortable"
            hide-details
            @update:model-value="gradePolicy.select"
          />
        </SettingsRow>
        <p
          v-if="gradePolicy.effective.value === 'passAtN'"
          class="text-body-small text-medium-emphasis grade-policy-note"
        >
          {{ t('settings.learning.gradePolicy.passAtN.description') }}
        </p>
        <v-alert
          v-if="gradePolicy.missing.value"
          type="warning"
          variant="tonal"
          density="compact"
          class="grade-policy-missing"
        >
          {{
            t('settings.learning.gradePolicy.missing', {
              id: gradePolicy.saved.value,
            })
          }}
        </v-alert>

        <p class="overline-label mt-4">
          {{ t('settings.learning.groups.experimental') }}
        </p>

        <SettingsRow
          :title="t('settings.learning.implicitCredit.title')"
          :description="t('settings.learning.implicitCredit.description')"
        >
          <v-switch
            v-model="form.implicitCreditEnabled"
            color="primary"
            inset
            hide-details
            :aria-label="t('settings.learning.implicitCredit.title')"
          />
        </SettingsRow>
      </div>

      <div class="actions mt-8">
        <v-btn
          color="primary"
          variant="flat"
          size="large"
          :disabled="!isDirty"
          :loading="busy"
          @click="save"
        >
          {{ t('common.save') }}
        </v-btn>
        <v-btn
          variant="text"
          size="large"
          :disabled="revertDisabled"
          @click="revert"
        >
          {{ t('settings.learning.actions.revert') }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="text"
          color="error"
          :disabled="busy"
          @click="confirmReset = true"
        >
          {{ t('settings.learning.actions.reset') }}
        </v-btn>
      </div>
    </template>

    <v-dialog v-model="confirmReset" max-width="420">
      <v-card class="pa-6">
        <h3 class="text-title-large font-weight-bold">
          {{ t('settings.learning.resetDialog.title') }}
        </h3>
        <p class="text-body-medium text-medium-emphasis mt-2">
          {{ t('settings.learning.resetDialog.text') }}
        </p>
        <div class="d-flex justify-end ga-2 mt-6">
          <v-btn variant="text" @click="confirmReset = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" @click="reset">
            {{ t('settings.learning.resetDialog.confirm') }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.value {
  min-width: 3rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.grade-policy-select {
  width: 280px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>
