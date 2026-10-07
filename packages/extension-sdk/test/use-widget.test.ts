import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, reactive } from 'vue';
import { WIDGET_HANDLE_KEY, type WidgetHandle } from '../src/index.ts';
import { useWidget } from '../src/client.ts';

const mountWith = (
  component: ReturnType<typeof defineComponent>,
  handle?: WidgetHandle,
) => {
  const host = document.createElement('div');
  const app = createApp(component);
  app.config.warnHandler = () => undefined;
  if (handle !== undefined) app.provide(WIDGET_HANDLE_KEY, handle);
  app.mount(host);
  return { host, app };
};

describe('useWidget', () => {
  it('returns the handle the app provides, with its reactive context', async () => {
    const context = reactive<{ courseId: string | null }>({ courseId: 'c1' });
    const handle: WidgetHandle = {
      widgetId: 'acme.card',
      context,
      call: async (commandId) => commandId,
    };
    let seen: WidgetHandle | undefined;
    const { host, app } = mountWith(
      defineComponent({
        setup() {
          seen = useWidget();
          return () => h('p', `${seen?.widgetId}:${seen?.context.courseId}`);
        },
      }),
      handle,
    );
    expect(seen).toBe(handle);
    expect(host.textContent).toBe('acme.card:c1');
    context.courseId = 'c2';
    await Promise.resolve();
    expect(host.textContent).toBe('acme.card:c2');
    app.unmount();
  });

  it('throws a clear error outside a widget', () => {
    expect(() =>
      mountWith(
        defineComponent({
          setup() {
            useWidget();
            return () => null;
          },
        }),
      ),
    ).toThrow(/widget component/);
  });
});
