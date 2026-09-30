<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { ItemReason } from '@spirula/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ITEM_REASON } from '@/shared/config/item-reason.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import PageHeader from '@/shared/ui/PageHeader.vue';
import { CourseScopeSwitcher, useCourseScope } from '@/features/course-scope';
import { useDailyPlan } from '../model/daily-plan.ts';
import OtherDue from './OtherDue.vue';
import { useI18n } from 'vue-i18n';

const UPCOMING_SHOWN = 5;
const COUNTED_REASONS: ItemReason[] = ['new', 'review', 'remediation'];
/** Ниже этой доли (в %) упражнение подсвечиваем как «забывается». */
const REMEMBERED_WARNING = 60;

const { t, d } = useI18n();
const engine = useEngine();
const router = useRouter();
const scope = useCourseScope();
const { plan, today, loading, error, refresh } = useDailyPlan(
  engine,
  scope.activeId,
);

const todayLabel = computed(() => d(today.value, 'fullDate'));

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

/** Значок и цвет «запомнено»; сам процент всегда написан цифрами. */
const rememberedView = (remembered: number) =>
  remembered < REMEMBERED_WARNING
    ? { icon: 'mdi-trending-down', color: 'warning' }
    : { icon: 'mdi-check-circle-outline', color: 'secondary' };

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
        {{ todayLabel }}
        <template v-if="plan">
          ·
          <span>{{ t('dailyPlan.total', { n: plan.entries.length }) }}</span>
        </template>
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
            <h2 class="text-headline-medium font-weight-bold mt-4">
              {{ hero.title }}
            </h2>
            <p class="text-body-large mt-2 opacity-90">{{ hero.origin }}</p>
            <v-btn
              class="hero-cta mt-6"
              size="large"
              color="hero-contrast"
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
              class="d-flex flex-column-reverse align-center"
            >
              <dt class="text-label-medium opacity-90">{{ item.label }}</dt>
              <dd class="text-display-small font-weight-bold ma-0">
                {{ item.count }}
              </dd>
            </div>
          </dl>
        </div>
      </v-card>

      <v-card v-else class="pa-4 mb-6">
        <v-empty-state
          icon="mdi-check-circle-outline"
          color="success"
          :title="t('dailyPlan.empty.title')"
          :text="emptyText"
        >
          <template #actions>
            <OtherDue
              v-if="otherDue.length"
              :courses="otherDue"
              @select="scope.select"
            />
            <v-btn
              v-else
              variant="tonal"
              color="primary"
              :to="{ name: ROUTE.courses }"
            >
              {{ t('dailyPlan.empty.toCourses') }}
            </v-btn>
          </template>
        </v-empty-state>
      </v-card>

      <v-card v-if="upcoming.length" class="pa-2 mb-6">
        <v-card-item>
          <v-card-title class="text-title-large font-weight-bold">
            {{ t('dailyPlan.upcoming.title') }}
          </v-card-title>
        </v-card-item>
        <!-- список без действий: не должен быть остановкой Tab -->
        <v-list lines="two" bg-color="transparent" tabindex="-1">
          <v-list-item
            v-for="entry in upcomingShown"
            :key="entry.exerciseId"
            :subtitle="entry.origin"
            rounded="lg"
          >
            <template #prepend>
              <v-avatar
                :color="ITEM_REASON[entry.reason].color"
                variant="tonal"
                rounded="lg"
                role="img"
                :aria-label="t(`reason.${entry.reason}`)"
                :title="t(`reason.${entry.reason}`)"
              >
                <v-icon :icon="ITEM_REASON[entry.reason].icon" />
              </v-avatar>
            </template>
            <template #title>
              <span class="text-wrap">{{ entry.title }}</span>
            </template>
            <template v-if="entry.remembered !== null" #append>
              <span
                class="d-inline-flex align-center ga-1 text-label-large text-medium-emphasis"
                role="img"
                :aria-label="t('dailyPlan.remembered', { n: entry.remembered })"
                :title="t('dailyPlan.remembered', { n: entry.remembered })"
              >
                <v-icon
                  :icon="rememberedView(entry.remembered).icon"
                  :color="rememberedView(entry.remembered).color"
                  size="16"
                />
                {{ entry.remembered }}%
              </span>
            </template>
          </v-list-item>
          <v-list-item
            v-if="upcomingHidden > 0"
            :title="t('dailyPlan.upcoming.more', { n: upcomingHidden })"
            class="text-medium-emphasis"
            rounded="lg"
          />
        </v-list>
      </v-card>

      <v-card v-if="hero && otherDue.length" class="pa-4">
        <OtherDue :courses="otherDue" @select="scope.select" />
      </v-card>
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
