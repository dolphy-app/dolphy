<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import {
  createFrameHost,
  overlayFrameHeight,
} from '@/shared/lib/frame-bridge.ts';
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
  widgetId: string;
  /** Привязка к расширению: задаёт приложение, из сообщений рамки не читается. */
  binding: PanelBinding;
  /** Границы высоты рамки, px (из манифеста). */
  minHeight: number;
  maxHeight: number;
  /** Окружение виджета (`ctx.context`): курс в фокусе; смена доходит до рамки без перезагрузки. */
  context: FrameContext;
}>();
const emit = defineEmits<{
  shortcut: [];
  error: [message: string];
}>();

const frame = useTemplateRef<HTMLIFrameElement>('frame');
const holder: { host: FrameHost | null } = { host: null };
// высота содержимого по `size`; рамка зажимает её в диапазон манифеста, выше — прокрутка внутри
const contentHeight = ref(0);
// высота, запрошенная оверлеем: на его время диапазон манифеста не действует, потолок — окно приложения
const overlay = ref<number | null>(null);
const ceiling = ref(window.innerHeight);
const readCeiling = () => {
  ceiling.value = window.innerHeight;
};
const height = computed(() =>
  overlayFrameHeight(
    Math.min(Math.max(contentHeight.value, props.minHeight), props.maxHeight),
    overlay.value,
    ceiling.value,
  ),
);

onMounted(() => {
  window.addEventListener('resize', readCeiling);
  if (frame.value === null) return;
  holder.host = createFrameHost({
    frame: frame.value,
    init: {
      mode: 'widget',
      rendererUrl: props.rendererUrl,
      widgetId: props.widgetId,
    },
    panel: props.binding,
    context: props.context,
    handlers: {
      onSize: (next) => {
        contentHeight.value = next;
      },
      onOverlay: (next) => {
        readCeiling();
        overlay.value = next;
      },
      onShortcut: () => emit('shortcut'),
      onError: (message) => emit('error', message),
    },
  });
});

watch(
  () => props.context.courseId,
  (courseId) => holder.host?.updateContext({ courseId }),
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', readCeiling);
  holder.host?.dispose();
});
</script>

<template>
  <iframe
    ref="frame"
    class="widget-frame"
    sandbox="allow-scripts"
    :src="src"
    :title="title"
    :style="{ height: `${height}px` }"
    data-mode="widget"
  />
</template>

<style scoped>
.widget-frame {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
}
</style>
