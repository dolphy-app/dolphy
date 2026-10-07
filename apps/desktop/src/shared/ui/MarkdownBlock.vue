<script setup lang="ts">
import {
  computed,
  onErrorCaptured,
  shallowRef,
  toRef,
  watch,
  watchEffect,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { isMountable } from '@dolphy-app/extension-api';
import type { ClientMarkdownRenderer } from '@/shared/lib/extension-clients.ts';
import ExtensionScope from './ExtensionScope.vue';
import MountableHost from './MountableHost.vue';

const props = defineProps<{
  /** Заглушка блока в разметке: сюда рисуется компонент рендерера. */
  target: HTMLElement;
  renderer: ClientMarkdownRenderer;
  language: string;
  source: string;
}>();

const { t } = useI18n();

const mountable = computed(() =>
  isMountable(props.renderer.component) ? props.renderer.component : null,
);
const vueComponent = computed(() =>
  isMountable(props.renderer.component) ? null : props.renderer.component,
);
const mountProps = computed(() => ({
  source: props.source,
  language: props.language,
}));

const host = toRef(props, 'target');

const failed = shallowRef(false);

const onMountError = () => {
  failed.value = true;
};

// новый экземпляр рендерера (обновление, правка в режиме разработчика) — рисуем заново
watch(
  () => props.renderer.key,
  () => {
    failed.value = false;
  },
);

// сбой рендера компонента расширения: блок показывает заметку, текст цел
onErrorCaptured((error) => {
  console.error(
    { error, language: props.language },
    'markdown block was not rendered',
  );
  failed.value = true;
  return false;
});

// заглушка пришла с исходником блока; дальше содержимое рисует этот компонент:
// формулу (или исходник и заметку, пока блок не удался)
watch(host, (element) => element.replaceChildren(), {
  immediate: true,
  flush: 'sync',
});

watchEffect(() => {
  host.value.dataset['state'] = failed.value ? 'error' : 'done';
});
</script>

<template>
  <Teleport :to="target">
    <template v-if="failed">
      <pre><code>{{ source }}</code></pre>
      <p class="dolphy-md-error" role="note">
        {{ t('markdown.renderFailed', { language }) }}
      </p>
    </template>
    <MountableHost
      v-else-if="mountable !== null"
      :key="renderer.key"
      :extension-id="renderer.extensionId"
      :mountable="mountable"
      :props="mountProps"
      @error="onMountError"
    />
    <ExtensionScope
      v-else-if="vueComponent !== null"
      :key="renderer.key"
      :extension-id="renderer.extensionId"
    >
      <component :is="vueComponent" :source="source" :language="language" />
    </ExtensionScope>
  </Teleport>
</template>
