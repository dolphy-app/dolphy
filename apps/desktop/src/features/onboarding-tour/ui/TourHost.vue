<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { targetSelector } from '../lib/tours.ts';
import { useOnboardingTour } from '../model/onboarding-tour.ts';
import TourOfferDialog from './TourOfferDialog.vue';
import TourSpotlight from './TourSpotlight.vue';
import TourStepCard from './TourStepCard.vue';

const tour = useOnboardingTour();
const route = useRoute();
const { t } = useI18n();

const runner = tour.runner;
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// первый запуск: предложение на странице оболочки, не в сессии и не во вход-тесте
watch(
  () => route.name,
  (name) => void tour.maybeOffer(name),
  {
    immediate: true,
  },
);

/** Карточка видна, когда шаг показан: во время перехода и ожидания цели её нет. */
const visible = computed(() => runner.running && !runner.state.busy);
const step = computed(() => runner.step);
const found = computed(() => runner.state.element);
// страница может перерисовать цель (данные пришли заново): тогда ищем её снова
const element = shallowRef<HTMLElement | null>(null);
watch(found, (next) => (element.value = next), { immediate: true });
const keepTarget = { frame: 0 };
const follow = () => {
  const target = step.value?.target;
  if (target && element.value && !element.value.isConnected) {
    const next = document.querySelector<HTMLElement>(targetSelector(target));
    if (next) element.value = next;
  }
  keepTarget.frame = requestAnimationFrame(follow);
};
keepTarget.frame = requestAnimationFrame(follow);
const total = computed(() => runner.state.tour?.steps.length ?? 0);
const key = computed(() => {
  const id = runner.state.tour?.id;
  const stepId = step.value?.id;
  return id && stepId ? `tour.${id}.${stepId}` : null;
});
const title = computed(() => (key.value ? t(`${key.value}.title`) : ''));
const text = computed(() => (key.value ? t(`${key.value}.text`) : ''));
const announcement = computed(() =>
  visible.value
    ? t('tour.card.announce', {
        n: runner.state.index + 1,
        total: total.value,
        title: title.value,
      })
    : '',
);

const card = ref<InstanceType<typeof TourStepCard> | null>(null);

// фокус уходит в карточку при каждом шаге и возвращается туда, где был до тура
// (страница могла пересоздаться: тогда элемент ищется по `data-focus-key`)
const previousFocus: { element: HTMLElement | null; key: string | null } = {
  element: null,
  key: null,
};
watch(
  () => runner.running,
  (running) => {
    if (running) {
      const active = document.activeElement;
      previousFocus.element = active instanceof HTMLElement ? active : null;
      previousFocus.key = previousFocus.element?.dataset.focusKey ?? null;
      window.addEventListener('keydown', onKeydown, true);
    } else {
      window.removeEventListener('keydown', onKeydown, true);
    }
  },
);
watch(tour.endedAt, async () => {
  await nextTick();
  const { element, key } = previousFocus;
  previousFocus.element = null;
  previousFocus.key = null;
  const byKey = key
    ? document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)
    : null;
  (element?.isConnected ? element : byKey)?.focus();
});
watch(
  () => (visible.value ? runner.state.index : -1),
  (index) => {
    if (index < 0) return;
    const target = element.value;
    target?.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    // оверлей рисуется со следующего кадра; повторный вызов безвреден
    setTimeout(() => card.value?.focus(), 60);
  },
  { flush: 'post' },
);

/** `→` далее, `←` назад, `Escape` пропустить; Enter и пробел на кнопках — их собственные. */
function onKeydown(event: KeyboardEvent) {
  if (!runner.running || event.defaultPrevented) return;
  if (event.key === 'Tab') {
    // фокус не уходит в затемнённую страницу, даже пока карточка пересоздаётся
    const root = document.querySelector<HTMLElement>('[data-tour-card]');
    if (!root?.contains(document.activeElement)) {
      event.preventDefault();
      root?.focus();
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    runner.skip();
  } else if (event.key === 'ArrowRight' && !runner.state.busy) {
    event.preventDefault();
    void runner.next();
  } else if (
    event.key === 'ArrowLeft' &&
    !runner.state.busy &&
    !runner.isFirst
  ) {
    event.preventDefault();
    void runner.previous();
  }
}
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
  cancelAnimationFrame(keepTarget.frame);
});
</script>

<template>
  <TourOfferDialog
    :model-value="tour.offerOpen.value"
    @start="tour.accept()"
    @skip="tour.decline()"
  />
  <template v-if="runner.running">
    <TourSpotlight :element="element" />
    <v-overlay
      v-if="visible && step && element"
      :key="key ?? undefined"
      :model-value="true"
      persistent
      no-click-animation
      :scrim="false"
      :target="element"
      :offset="14"
      location-strategy="connected"
      :location="step.placement ?? 'bottom'"
      origin="auto"
      :transition="reducedMotion ? false : 'fade-transition'"
    >
      <TourStepCard
        ref="card"
        :title="title"
        :text="text"
        :step="runner.state.index + 1"
        :total="total"
        :is-first="runner.isFirst"
        :is-last="runner.isLast"
        @back="runner.previous()"
        @next="runner.next()"
        @skip="runner.skip()"
      />
    </v-overlay>
    <!-- шаг без цели: карточка по центру, затемнение рисует TourSpotlight -->
    <v-dialog
      v-else-if="visible && step"
      :key="key ?? undefined"
      :model-value="true"
      persistent
      no-click-animation
      :scrim="false"
      width="auto"
      :transition="reducedMotion ? false : 'fade-transition'"
    >
      <TourStepCard
        ref="card"
        :title="title"
        :text="text"
        :step="runner.state.index + 1"
        :total="total"
        :is-first="runner.isFirst"
        :is-last="runner.isLast"
        @back="runner.previous()"
        @next="runner.next()"
        @skip="runner.skip()"
      />
    </v-dialog>
    <!-- смену шага слышит и скринридер: карточка при переходе пересоздаётся -->
    <div
      class="tour-sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ announcement }}
    </div>
  </template>
</template>

<style scoped>
.tour-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
