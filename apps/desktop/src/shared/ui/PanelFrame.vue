<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import type { JsonValue } from '@dolphy-app/extension-api';
import { createFrameHost } from '@/shared/lib/frame-bridge.ts';
import type {
  FrameContext,
  FrameHost,
  PanelBinding,
} from '@/shared/lib/frame-bridge.ts';

const props = defineProps<{
  /** Страница рамки: `dolphy-ext://<id>/__dolphy/frame.html`. */
  src: string;
  title: string;
  rendererUrl: string;
  panelId: string;
  /** Привязка к расширению: задаёт приложение, из сообщений рамки не читается. */
  binding: PanelBinding;
  /** Свойства, с которыми панель открыта (`openPanel(id, props)`). */
  panelProps?: JsonValue;
  /** Окружение панели (`ctx.context`): курс в фокусе; смена доходит до рамки без перезагрузки. */
  context: FrameContext;
}>();
const emit = defineEmits<{
  shortcut: [];
  error: [message: string];
}>();

const frame = useTemplateRef<HTMLIFrameElement>('frame');
const holder: { host: FrameHost | null } = { host: null };

onMounted(() => {
  if (frame.value === null) return;
  holder.host = createFrameHost({
    frame: frame.value,
    init: {
      mode: 'panel',
      rendererUrl: props.rendererUrl,
      panelId: props.panelId,
      ...(props.panelProps === undefined ? {} : { props: props.panelProps }),
    },
    panel: props.binding,
    context: props.context,
    handlers: {
      onShortcut: () => emit('shortcut'),
      onError: (message) => emit('error', message),
    },
  });
});

watch(
  () => props.panelProps,
  (next) => holder.host?.updatePanelProps(next),
  { deep: true },
);

watch(
  () => props.context.courseId,
  (courseId) => holder.host?.updateContext({ courseId }),
);

onBeforeUnmount(() => holder.host?.dispose());
</script>

<template>
  <iframe
    ref="frame"
    class="panel-frame"
    sandbox="allow-scripts"
    :src="src"
    :title="title"
    data-mode="panel"
  />
</template>

<style scoped>
/* панель заполняет контейнер: высоту задаёт страница, рамка `size` не сообщает */
.panel-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
</style>
