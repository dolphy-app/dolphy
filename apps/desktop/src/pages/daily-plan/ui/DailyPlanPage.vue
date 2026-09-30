<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { ItemReason } from '@lms/engine-contract';
import { useEngine } from '@/shared/api/engine';
import { ITEM_REASON } from '@/shared/config/item-reason.ts';
import { ROUTE } from '@/shared/config/routes.ts';
import { useDailyPlan } from '../model/daily-plan.ts';
import { useI18n } from 'vue-i18n';

const UPCOMING_SHOWN = 5;
const COUNTED_REASONS: ItemReason[] = ['new', 'review', 'remediation'];

const { t, d } = useI18n();
const engine = useEngine();
const router = useRouter();
const { plan, loading, error, refresh } = useDailyPlan(engine);

const today = d(new Date(), 'fullDate');

const hero = computed(() => plan.value?.entries[0] ?? null);
const upcoming = computed(() => plan.value?.entries.slice(1) ?? []);
const upcomingShown = computed(() => upcoming.value.slice(0, UPCOMING_SHOWN));

const counts = computed(() =>
  COUNTED_REASONS.map((reason) => ({
    reason,
    label: t(`reason.${reason}`),
    count:
      plan.value?.entries.filter((entry) => entry.reason === reason).length ??
      0,
  })).filter(({ reason, count }) => count > 0 || reason !== 'remediation'),
);

const startSession = () => {
  if (!plan.value) return;
  void router.push({
    name: ROUTE.session,
    query: { seed: String(plan.value.seed) },
  });
};
</script>

<template>
  <v-container max-width="1000" class="pa-8">
    <header class="mb-8">
      <h1 class="text-display-small font-weight-bold">
        {{ t('dailyPlan.title') }}
      </h1>
      <p class="text-body-large text-medium-emphasis first-upper">
        {{ today }}
      </p>
    </header>

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

    <v-progress-linear v-if="loading && !plan" indeterminate rounded />

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
          :text="t('dailyPlan.empty.text')"
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
                v-if="upcoming.length > upcomingShown.length"
                :title="
                  t('dailyPlan.upcoming.more', {
                    n: upcoming.length - upcomingShown.length,
                  })
                "
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
                    :color="entry.remembered < 60 ? 'warning' : 'secondary'"
                  >
                    {{ entry.remembered }}%
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
            <p v-else class="text-body-medium text-medium-emphasis px-4 pb-4">
              {{ t('dailyPlan.due.empty') }}
            </p>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<style scoped>
.hero {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
}

.hero .hero-cta.v-btn {
  color: #4f46e5;
}

.hero-text {
  flex: 1 1 20rem;
  max-width: 40rem;
}
</style>
