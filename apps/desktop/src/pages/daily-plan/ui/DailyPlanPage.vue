<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { ItemReason } from '@lms/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ITEM_REASON } from '@/shared/config/item-reason.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { CourseScopeSwitcher, useCourseScope } from '@/features/course-scope';
import { useDailyPlan } from '../model/daily-plan.ts';
import { useI18n } from 'vue-i18n';

const UPCOMING_SHOWN = 5;
const COUNTED_REASONS: ItemReason[] = ['new', 'review', 'remediation'];
/** Ниже этой доли (в %) упражнение подсвечиваем как «забывается». */
const REMEMBERED_WARNING = 60;

const { t, d } = useI18n();
const engine = useEngine();
const router = useRouter();
const scope = useCourseScope();
const { plan, loading, error, refresh } = useDailyPlan(engine, scope.activeId);

const today = d(new Date(), 'fullDate');

const hero = computed(() => plan.value?.entries[0] ?? null);
const upcoming = computed(() => plan.value?.entries.slice(1) ?? []);
const upcomingShown = computed(() => upcoming.value.slice(0, UPCOMING_SHOWN));
const upcomingHidden = computed(
  () => upcoming.value.length - upcomingShown.value.length,
);
const initialLoading = computed(() => loading.value && !plan.value);

const counts = computed(() =>
  COUNTED_REASONS.map((reason) => ({
    reason,
    label: t(`reason.${reason}`),
    count:
      plan.value?.entries.filter((entry) => entry.reason === reason).length ??
      0,
  })).filter(({ reason, count }) => count > 0 || reason !== 'remediation'),
);

// повторения в остальных курсах: в план не попадают, но о них напоминаем
const otherDue = computed(() =>
  scope.activeId.value === null
    ? []
    : scope.courses.value.filter(
        ({ id, due }) => id !== scope.activeId.value && due > 0,
      ),
);

const emptyText = computed(() => {
  const course = scope.active.value;
  return course
    ? t('dailyPlan.empty.scopedText', { course: course.name })
    : t('dailyPlan.empty.text');
});
const rememberedColor = (remembered: number) =>
  remembered < REMEMBERED_WARNING ? 'warning' : 'secondary';

const startSession = () => {
  if (!plan.value) return;
  const { seed, courseId } = plan.value;
  void router.push({
    name: ROUTE.session,
    query:
      courseId === null
        ? { seed: String(seed) }
        : { seed: String(seed), course: courseId },
  });
};
</script>

<template>
  <v-container max-width="1000" class="pa-8">
    <PageHeader :title="t('dailyPlan.title')">
      <p class="text-body-large text-medium-emphasis first-upper mt-1">
        {{ today }}
      </p>
      <CourseScopeSwitcher class="mt-4" />
    </PageHeader>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="error"
    >
      <template #append>
        <v-btn variant="text" @click="refresh">{{ t('common.retry') }}</v-btn>
      </template>
    </v-alert>

    <v-progress-linear v-if="initialLoading" indeterminate rounded />

    <template v-else-if="plan">
      <v-card
        v-if="hero"
        theme="dark"
        :border="false"
        rounded="xl"
        class="hero pa-8 mb-6"
      >
        <div class="d-flex flex-wrap align-center justify-space-between ga-8">
          <div class="hero-text">
            <v-chip
              size="small"
              variant="tonal"
              :prepend-icon="ITEM_REASON[hero.reason].icon"
            >
              {{ t(`reason.${hero.reason}`) }}
            </v-chip>
            <h2 class="text-headline-large font-weight-bold mt-4">
              {{ hero.title }}
            </h2>
            <p class="text-body-large mt-2 opacity-70">{{ hero.origin }}</p>
            <v-btn
              class="hero-cta mt-6"
              size="large"
              color="white"
              append-icon="mdi-arrow-right"
              @click="startSession"
            >
              {{ t('dailyPlan.hero.start') }}
            </v-btn>
          </div>
          <dl class="d-flex ga-8">
            <div
              v-for="item in counts"
              :key="item.reason"
              class="d-flex flex-column-reverse"
            >
              <dt class="text-label-medium opacity-70">{{ item.label }}</dt>
              <dd class="text-display-small font-weight-bold">
                {{ item.count }}
              </dd>
            </div>
          </dl>
        </div>
      </v-card>

      <v-card v-else class="pa-4 mb-6">
        <v-empty-state
          icon="mdi-check-circle-outline"
          :title="t('dailyPlan.empty.title')"
          :text="emptyText"
        />
      </v-card>

      <v-row>
        <v-col cols="12" md="7">
          <v-card class="pa-2 h-100">
            <v-card-item>
              <v-card-title class="text-title-large font-weight-bold">
                {{ t('dailyPlan.upcoming.title') }}
              </v-card-title>
              <template #append>
                <span class="text-body-small text-medium-emphasis">
                  {{
                    t('dailyPlan.upcoming.total', { n: plan.entries.length })
                  }}
                </span>
              </template>
            </v-card-item>
            <v-list
              v-if="upcomingShown.length"
              lines="two"
              bg-color="transparent"
            >
              <v-list-item
                v-for="entry in upcomingShown"
                :key="entry.exerciseId"
                :title="entry.title"
                :subtitle="entry.origin"
                rounded="lg"
              >
                <template #prepend>
                  <v-avatar
                    :color="ITEM_REASON[entry.reason].color"
                    variant="tonal"
                    rounded="lg"
                  >
                    <v-icon :icon="ITEM_REASON[entry.reason].icon" />
                  </v-avatar>
                </template>
              </v-list-item>
              <v-list-item
                v-if="upcomingHidden > 0"
                :title="t('dailyPlan.upcoming.more', { n: upcomingHidden })"
                class="text-medium-emphasis"
                rounded="lg"
              />
            </v-list>
            <p v-else class="text-body-medium text-medium-emphasis px-4 pb-4">
              {{ t('dailyPlan.upcoming.empty') }}
            </p>
          </v-card>
        </v-col>

        <v-col cols="12" md="5">
          <v-card class="pa-2 h-100">
            <v-card-item>
              <v-card-title class="text-title-large font-weight-bold">
                {{ t('dailyPlan.due.title') }}
              </v-card-title>
            </v-card-item>
            <v-list v-if="plan.due.length" lines="two" bg-color="transparent">
              <v-list-item
                v-for="entry in plan.due"
                :key="entry.exerciseId"
                :title="entry.title"
                :subtitle="entry.origin"
                rounded="lg"
              >
                <template #append>
                  <v-chip
                    size="small"
                    variant="tonal"
                    :color="rememberedColor(entry.remembered)"
                  >
                    {{ entry.remembered }}%
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
            <p v-else class="text-body-medium text-medium-emphasis px-4 pb-4">
              {{ t('dailyPlan.due.empty') }}
            </p>
            <div v-if="otherDue.length" class="px-4 pb-4">
              <p class="text-label-medium text-medium-emphasis mb-2">
                {{ t('courseScope.otherDue') }}
              </p>
              <v-chip-group column>
                <v-chip
                  v-for="course in otherDue"
                  :key="course.id"
                  size="small"
                  variant="tonal"
                  color="warning"
                  @click="scope.select(course.id)"
                >
                  {{ course.name }} · {{ course.due }}
                </v-chip>
              </v-chip-group>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
.hero {
  background: linear-gradient(
    135deg,
    rgb(var(--v-theme-hero-start)) 0%,
    rgb(var(--v-theme-hero-end)) 100%
  );
}

.hero .hero-cta.v-btn {
  color: rgb(var(--v-theme-hero-start));
}

.hero-text {
  flex: 1 1 20rem;
  max-width: 40rem;
}
</style>
