<script setup lang="ts">
import { onErrorCaptured, shallowRef, toRef, watch, watchEffect } from 'vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MarkdownRendererDto } from '@dolphy-app/engine-contract';
import {
  importExtensionModule,
  loadExtensionComponent,
} from '@/shared/lib/extension-component.ts';
import type { LoadExtensionModule } from '@/shared/lib/extension-component.ts';
import { moduleUrlOf } from '@/shared/lib/extension-url.ts';

const props = withDefaults(
  defineProps<{
    /** Заглушка блока в разметке: сюда рисуется компонент рендерера. */
    target: HTMLElement;
    renderer: MarkdownRendererDto;
    language: string;
    source: string;
    loadModule?: LoadExtensionModule;
  }>(),
  { loadModule: importExtensionModule },
);

const { t } = useI18n();
const host = toRef(props, 'target');

const component = shallowRef<Component | null>(null);
const failed = shallowRef(false);
let token = 0;

const load = async () => {
  const current = ++token;
  failed.value = false;
  component.value = null;
  try {
    const loaded = await loadExtensionComponent(
      props.renderer,
      'markdown',
      props.language,
      props.loadModule,
    );
    if (current === token) component.value = loaded;
  } catch (error) {
    if (current !== token) return;
    console.error(
      { error, language: props.language },
      'markdown block was not rendered',
    );
    failed.value = true;
  }
};
// новая ревизия или другой модуль рендерера — загрузка заново
watch(() => moduleUrlOf(props.renderer), load, { immediate: true });

// сбой рендера компонента расширения: блок показывает заметку, текст цел
onErrorCaptured((error) => {
  console.error(
    { error, language: props.language },
    'markdown block was not rendered',
  );
  failed.value = true;
  component.value = null;
  return false;
});

// заглушка пришла с исходником блока; дальше содержимое рисует этот компонент:
// формулу (или исходник и заметку, пока блок не готов или не удался)
watch(host, (element) => element.replaceChildren(), {
  immediate: true,
  flush: 'sync',
});

watchEffect(() => {
  const state = component.value === null ? 'loading' : 'done';
  host.value.dataset['state'] = failed.value ? 'error' : state;
});
</script>

<template>
  <Teleport :to="target">
    <component
      :is="component"
      v-if="component !== null"
      :source="source"
      :language="language"
    />
    <template v-else>
      <pre><code>{{ source }}</code></pre>
      <p v-if="failed" class="dolphy-md-error" role="note">
        {{ t('markdown.renderFailed', { language }) }}
      </p>
    </template>
  </Teleport>
</template>
