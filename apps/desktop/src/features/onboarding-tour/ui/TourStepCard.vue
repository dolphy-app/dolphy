<script setup lang="ts">
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{
  title: string;
  text: string;
  /** Значок шага (mdi); без него плитки нет. */
  icon?: string;
  /** Номер шага с единицы. */
  step: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
}>();
const emit = defineEmits<{ back: []; next: []; skip: [] }>();

const { t } = useI18n();
const id = useId();
const card = ref<{ $el: HTMLElement } | null>(null);

const BUTTONS = 'button:not([disabled])';

/** Tab ходит по кнопкам карточки и не уходит в затемнённую страницу. */
const trapFocus = (event: KeyboardEvent) => {
  if (event.key !== 'Tab' || !card.value) return;
  const buttons = [...card.value.$el.querySelectorAll<HTMLElement>(BUTTONS)];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === card.value.$el)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
};

defineExpose({ focus: () => card.value?.$el.focus() });
</script>

<template>
  <v-card
    ref="card"
    class="tour-card pa-5"
    elevation="8"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-text`"
    data-tour-card
    @keydown="trapFocus"
  >
    <div class="d-flex align-start ga-3">
      <!-- плитка как у карточки курса: значок шага, а не просто текст -->
      <v-avatar
        v-if="icon"
        color="primary"
        variant="tonal"
        rounded="lg"
        size="40"
      >
        <v-icon :icon="icon" size="22" aria-hidden="true" />
      </v-avatar>
      <div class="min-width-0">
        <p class="text-label-large text-medium-emphasis ma-0">
          {{ t('tour.card.progress', { n: step, total }) }}
        </p>
        <h2 :id="`${id}-title`" class="title text-title-large font-weight-bold">
          {{ title }}
        </h2>
      </div>
    </div>
    <p :id="`${id}-text`" class="text-body-medium mt-3 mb-0">{{ text }}</p>
    <!-- число шагов уже в тексте «Шаг N из M»: точки для глаза, скринридеру скрыты -->
    <div class="d-flex ga-1 mt-4" aria-hidden="true">
      <span
        v-for="n in total"
        :key="n"
        class="dot"
        :class="{ active: n === step, passed: n < step }"
      />
    </div>
    <div class="d-flex flex-wrap align-center justify-space-between ga-2 mt-4">
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-close"
        @click="emit('skip')"
      >
        {{ t('tour.card.skip') }}
      </v-btn>
      <div class="d-flex ga-2">
        <!-- только значок: иначе три подписи не помещаются в карточку -->
        <v-btn
          v-if="!isFirst"
          variant="tonal"
          icon="mdi-arrow-left"
          width="44"
          height="44"
          :aria-label="t('tour.card.back')"
          @click="emit('back')"
        />
        <v-btn
          variant="flat"
          color="primary"
          height="44"
          :prepend-icon="isLast ? 'mdi-check' : undefined"
          :append-icon="isLast ? undefined : 'mdi-arrow-right'"
          @click="emit('next')"
        >
          {{ isLast ? t('tour.card.done') : t('tour.card.next') }}
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.tour-card {
  /* контейнер диалога: фокус на нём только для скринридера, управляют кнопки */
  outline: none;
  width: 24rem;
  max-width: calc(100vw - 2rem);
}

.min-width-0 {
  min-width: 0;
}

.title {
  overflow-wrap: anywhere;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface-variant));
  opacity: 0.35;
}

.dot.passed {
  background: rgb(var(--v-theme-primary));
  opacity: 0.55;
}

.dot.active {
  background: rgb(var(--v-theme-primary));
  opacity: 1;
  width: 1.25rem;
  border-radius: 0.25rem;
}
</style>
