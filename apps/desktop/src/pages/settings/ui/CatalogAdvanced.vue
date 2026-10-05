<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useEngine } from '@/shared/api/engine';
import { useCatalogSource } from '../model/catalog-source.ts';

/** «Каталог → Дополнительно»: адрес каталога расширений. */
const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();
const {
  source,
  draft,
  error,
  busy,
  locked,
  canApply,
  canReset,
  load,
  apply,
  reset,
} = useCatalogSource(useEngine());

const open = ref(false);
/** Адрес принят и действует; снимается, когда пользователь снова правит поле. */
const applied = ref(false);

const errorText = computed(() => {
  const current = error.value;
  if (current === null) return undefined;
  return current.kind === 'rejected'
    ? t(`settings.extensions.catalog.advanced.errors.${current.reason}`)
    : t('settings.extensions.catalog.advanced.failed', {
        message: current.message,
      });
});

watch(draft, () => {
  applied.value = false;
});

const done = async (accepted: Promise<boolean>) => {
  if (await accepted) {
    applied.value = true;
    emit('changed');
  }
};
const submit = () => {
  if (canApply.value) void done(apply());
};
const restore = () => {
  if (canReset.value) void done(reset());
};

onMounted(() => void load());
</script>

<template>
  <section class="mt-6" data-testid="catalog-advanced">
    <v-btn
      variant="text"
      size="small"
      color="primary"
      :append-icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'"
      :aria-expanded="open"
      aria-controls="catalog-advanced-body"
      data-testid="catalog-advanced-toggle"
      @click="open = !open"
    >
      {{ t('settings.extensions.catalog.advanced.title') }}
    </v-btn>

    <div
      v-show="open"
      id="catalog-advanced-body"
      class="mt-2"
      data-testid="catalog-advanced-body"
    >
      <form
        class="d-flex flex-wrap align-start ga-3"
        novalidate
        @submit.prevent="submit"
      >
        <v-text-field
          v-model="draft"
          class="address"
          type="url"
          variant="outlined"
          density="comfortable"
          autocomplete="off"
          spellcheck="false"
          persistent-hint
          :label="t('settings.extensions.catalog.advanced.addressLabel')"
          :hint="t('settings.extensions.catalog.advanced.addressHint')"
          :disabled="locked || busy"
          :error-messages="errorText"
          data-testid="catalog-url-input"
        />
        <div class="d-flex ga-2 mt-1">
          <v-btn
            type="submit"
            variant="flat"
            color="primary"
            :disabled="!canApply"
            :loading="busy"
            data-testid="catalog-url-apply"
          >
            {{ t('settings.extensions.catalog.advanced.apply') }}
          </v-btn>
          <v-btn
            variant="tonal"
            :disabled="!canReset"
            data-testid="catalog-url-reset"
            @click="restore"
          >
            {{ t('settings.extensions.catalog.advanced.reset') }}
          </v-btn>
        </div>
      </form>

      <p
        v-if="source"
        class="d-flex flex-wrap align-center ga-2 text-body-small mt-3"
        data-testid="catalog-url-current"
      >
        <span class="text-medium-emphasis">{{
          t('settings.extensions.catalog.advanced.current')
        }}</span>
        <span class="url" data-testid="catalog-url-value">{{
          source.url
        }}</span>
        <v-chip
          size="small"
          label
          :data-testid="`catalog-url-${source.origin}`"
        >
          {{
            t(`settings.extensions.catalog.advanced.origin.${source.origin}`)
          }}
        </v-chip>
      </p>

      <p
        v-if="locked"
        class="d-flex align-center ga-1 text-body-small mt-2"
        data-testid="catalog-url-env"
      >
        <v-icon
          icon="mdi-information-outline"
          size="small"
          aria-hidden="true"
        />
        {{ t('settings.extensions.catalog.advanced.envNote') }}
      </p>
      <p class="text-body-small text-medium-emphasis mt-2">
        {{ t('settings.extensions.catalog.advanced.formerNote') }}
      </p>
      <p
        class="applied d-flex align-center ga-1 text-body-small mt-2"
        role="status"
        aria-live="polite"
      >
        <template v-if="applied">
          <v-icon
            icon="mdi-check-circle-outline"
            color="success"
            size="small"
            aria-hidden="true"
          />
          <span data-testid="catalog-url-applied">{{
            t('settings.extensions.catalog.advanced.applied')
          }}</span>
        </template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.address {
  flex: 1 1 22rem;
}

.url {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}

.applied {
  min-height: 1.25rem;
}
</style>
