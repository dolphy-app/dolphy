<script setup lang="ts">
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{
  title: string;
  text: string;
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
    data-tour-card
    elevation="8"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-text`"
    @keydown="trapFocus"
  >
    <p class="text-label-large text-medium-emphasis ma-0">
      {{ t('tour.card.progress', { n: step, total }) }}
    </p>
    <h2 :id="`${id}-title`" class="text-title-large font-weight-bold mt-1">
      {{ title }}
    </h2>
    <p :id="`${id}-text`" class="text-body-medium mt-2 mb-0">{{ text }}</p>
    <div class="d-flex align-center justify-space-between ga-2 mt-5">
      <v-btn variant="text" size="small" @click="emit('skip')">
        {{ t('tour.card.skip') }}
      </v-btn>
      <div class="d-flex ga-2">
        <v-btn v-if="!isFirst" variant="tonal" @click="emit('back')">
          {{ t('tour.card.back') }}
        </v-btn>
        <v-btn variant="flat" color="primary" @click="emit('next')">
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
  width: 22rem;
  max-width: calc(100vw - 2rem);
}
</style>
