<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import { ENGINE_KEY } from '@dolphy-app/extension-api';
import type {
  AnswerChange,
  AppLocale,
  AppTheme,
  MountContext,
  Mountable,
  Unmount,
} from '@dolphy-app/extension-api';
import { callRpc } from '@dolphy-app/extension-sdk/rpc';
import { EXTENSION_APPS_KEY } from '@/shared/lib/extension-context.ts';

const props = defineProps<{
  extensionId: string;
  mountable: Mountable<unknown, unknown, unknown>;
  /** Текущие значения поверхности: панель, вставка, вид ответа, блок markdown. */
  props: Readonly<Record<string, unknown>>;
  /** `PanelHandle` панели или `InjectionHandle` вставки. */
  handle?: unknown;
}>();

const emit = defineEmits<{
  change: [detail: AnswerChange];
  submit: [];
  /** Ошибка `mount`, очистки или `ctx.reportError`: поверхность заменяет область карточкой. */
  error: [error: unknown];
}>();

const apps = inject(EXTENSION_APPS_KEY);
const engine = inject<ExtensionEngine | null>(ENGINE_KEY, null);
if (!apps) throw new Error('extension apps are not provided');
if (engine === null) throw new Error('extension engine is not provided');
const app = apps.of(props.extensionId);

const root = useTemplateRef<HTMLDivElement>('root');
const controller = new AbortController();
let disposed = false;
let cleanup: Unmount | null = null;
const stops: (() => void)[] = [];

const snapshot = (value: Readonly<Record<string, unknown>>) =>
  Object.freeze({ ...value });
let current = snapshot(props.props);

const fail = (error: unknown) => {
  console.error(
    { error, extensionId: props.extensionId },
    'mountable component failed',
  );
  if (!disposed) emit('error', error);
};

const subscribe = <T,>(
  watchSource: () => T,
  after?: (value: T) => void,
): ((listener: (value: T) => void) => () => void) => {
  const listeners = new Set<(value: T) => void>();
  stops.push(
    watch(watchSource, (value) => {
      after?.(value);
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          fail(error);
        }
      }
    }),
  );
  return (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
};

const onProps = subscribe(
  () => props.props,
  (value) => {
    current = snapshot(value);
  },
);
const onTheme = subscribe<AppTheme>(() => app.theme);
const onLocale = subscribe<AppLocale>(() => app.locale);

const context: MountContext<unknown, unknown, unknown> = {
  get props() {
    return current;
  },
  onProps: (listener) => onProps(() => listener(current)),
  emit: (event, payload) => {
    if (disposed) return;
    if (event === 'change') emit('change', payload as AnswerChange);
    else if (event === 'submit') emit('submit');
  },
  app,
  engine,
  callRpc: (contract, input) =>
    callRpc({ extensionId: props.extensionId, engine }, contract, input),
  get theme() {
    return app.theme;
  },
  onTheme,
  get locale() {
    return app.locale;
  },
  onLocale,
  extensionId: props.extensionId,
  signal: controller.signal,
  reportError: fail,
  handle: props.handle,
};

const runCleanup = async (unmount: Unmount) => {
  try {
    await unmount();
  } catch (error) {
    fail(error);
  }
};

onMounted(() => {
  const element = root.value;
  if (element === null) return;
  let result: Unmount | Promise<Unmount>;
  try {
    result = props.mountable.mount(element, context);
  } catch (error) {
    fail(error);
    return;
  }
  if (typeof result === 'function') {
    cleanup = result;
    return;
  }
  result.then(
    (unmount) => {
      if (disposed) void runCleanup(unmount);
      else cleanup = unmount;
    },
    (error: unknown) => fail(error),
  );
});

onBeforeUnmount(() => {
  disposed = true;
  controller.abort();
  for (const stop of stops) stop();
  const unmount = cleanup;
  cleanup = null;
  if (unmount !== null) void runCleanup(unmount);
});
</script>

<template>
  <div ref="root" class="mountable-host" data-testid="mountable-host"></div>
</template>
