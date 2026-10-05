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
import { placeCard } from '../lib/placement.ts';
import type { Box, Size } from '../lib/placement.ts';
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

/** Отступ подсветки от границ цели, px. */
const PADDING = 6;
const box = shallowRef<Box | null>(null);
const viewport = shallowRef<Size>({
  width: window.innerWidth,
  height: window.innerHeight,
});
const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height);
// один кадровый цикл: цель, подсветка и карточка следуют за прокруткой вложенных
// контейнеров и размером окна; перерисованная страницей цель ищется заново
const keepTarget = { frame: 0 };
const follow = () => {
  const target = step.value?.target;
  if (target && element.value && !element.value.isConnected) {
    const next = document.querySelector<HTMLElement>(targetSelector(target));
    if (next) element.value = next;
  }
  const el = element.value;
  let next: Box | null = null;
  if (el?.isConnected) {
    const rect = el.getBoundingClientRect();
    next = {
      left: Math.round(rect.left - PADDING),
      top: Math.round(rect.top - PADDING),
      width: Math.round(rect.width + PADDING * 2),
      height: Math.round(rect.height + PADDING * 2),
    };
  }
  if (!sameBox(box.value, next)) box.value = next;
  if (
    viewport.value.width !== window.innerWidth ||
    viewport.value.height !== window.innerHeight
  ) {
    viewport.value = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  keepTarget.frame = requestAnimationFrame(follow);
};
keepTarget.frame = requestAnimationFrame(follow);

// размер карточки известен после отрисовки: до этого она скрыта в углу
const popover = ref<HTMLElement | null>(null);
const size = shallowRef<Size | null>(null);
const observer = new ResizeObserver(([entry]) => {
  if (entry)
    size.value = {
      width: entry.target.getBoundingClientRect().width,
      height: entry.target.getBoundingClientRect().height,
    };
});
watch(popover, (el, previous) => {
  if (previous) observer.unobserve(previous);
  size.value = null;
  if (el) observer.observe(el);
});
const placement = computed(() =>
  box.value && size.value
    ? placeCard(box.value, size.value, viewport.value, step.value?.placement)
    : null,
);
const popoverStyle = computed(() =>
  placement.value
    ? { left: `${placement.value.left}px`, top: `${placement.value.top}px` }
    : { left: '0px', top: '0px', visibility: 'hidden' as const },
);
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

// карточка не помещается рядом с высокой целью: поднимаем цель к верху окна,
// под ней появляется место (один раз на шаг; `scroll-margin` задан в global.css)
const scrolledFor: { key: string | null } = { key: null };
watch(placement, (next) => {
  if (!next || next.overlap === 0 || scrolledFor.key === key.value) return;
  scrolledFor.key = key.value;
  element.value?.scrollIntoView({
    block: 'start',
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
});

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
  observer.disconnect();
});
</script>

<template>
  <TourOfferDialog
    :model-value="tour.offerOpen.value"
    @start="tour.accept()"
    @skip="tour.decline()"
  />
  <template v-if="runner.running">
    <TourSpotlight :box="box" />
    <!-- рядом с целью, не на ней: сторона выбирается так, чтобы карточка не закрывала подсветку -->
    <Transition name="tour-fade" mode="out-in" appear>
      <div
        v-if="visible && step && element"
        :key="key ?? undefined"
        ref="popover"
        class="tour-popover"
        :style="popoverStyle"
      >
        <TourStepCard
          ref="card"
          :title="title"
          :text="text"
          :icon="step.icon"
          :step="runner.state.index + 1"
          :total="total"
          :is-first="runner.isFirst"
          :is-last="runner.isLast"
          @back="runner.previous()"
          @next="runner.next()"
          @skip="runner.skip()"
        />
      </div>
    </Transition>
    <!-- шаг без цели: карточка по центру, затемнение рисует TourSpotlight -->
    <v-dialog
      v-if="visible && step && !element"
      :key="key ?? undefined"
      :model-value="true"
      persistent
      no-click-animation
      :scrim="false"
      width="auto"
      :transition="false"
    >
      <TourStepCard
        ref="card"
        :title="title"
        :text="text"
        :icon="step.icon"
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
.tour-popover {
  position: fixed;
  z-index: 2000;
}

.tour-fade-enter-active {
  transition: opacity 0.15s;
}

.tour-fade-enter-from {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tour-fade-enter-active {
    transition: none;
  }
}

.tour-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
