import type { AnswerChange } from '@dolphy-app/extension-api';
import { createApp, h, nextTick, reactive } from 'vue';
import type { Component } from 'vue';
import { createVuetify } from 'vuetify';

export interface MountedView {
  readonly host: HTMLElement;
  readonly changes: AnswerChange[];
  readonly submissions: number;
  query<T extends Element = Element>(selector: string): T | null;
  queryAll<T extends Element = Element>(selector: string): T[];
  /** Меняет свойства вида, как приложение, и ждёт перерисовки. */
  update(props: Record<string, unknown>): Promise<void>;
  dispose(): void;
}

/** Монтирует вид ответа с теми же свойствами и событиями, что у окна. */
export const mountView = async (
  component: Component,
  initial: Record<string, unknown> = {},
): Promise<MountedView> => {
  const props = reactive<Record<string, unknown>>({
    view: undefined,
    value: undefined,
    disabled: false,
    verdict: null,
    label: null,
    ...initial,
  });
  const changes: AnswerChange[] = [];
  const state = { submissions: 0 };
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(component, {
        ...props,
        onChange: (change: AnswerChange) => changes.push(change),
        onSubmit: () => {
          state.submissions += 1;
        },
      }),
  });
  app.use(createVuetify());
  app.mount(host);
  const settle = async () => {
    await nextTick();
    await nextTick();
  };
  await settle();
  return {
    host,
    changes,
    get submissions() {
      return state.submissions;
    },
    query: <T extends Element>(selector: string) =>
      host.querySelector<T>(selector),
    queryAll: <T extends Element>(selector: string) => [
      ...host.querySelectorAll<T>(selector),
    ],
    update: async (next) => {
      Object.assign(props, next);
      await settle();
    },
    dispose: () => {
      app.unmount();
      host.remove();
    },
  };
};
