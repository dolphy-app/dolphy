import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, reactive } from 'vue';
import { PANEL_HANDLE_KEY, type PanelHandle } from '../src/index.ts';
import { usePanel } from '../src/client.ts';

const mountWith = (
  component: ReturnType<typeof defineComponent>,
  handle?: PanelHandle,
) => {
  const host = document.createElement('div');
  const app = createApp(component);
  app.config.warnHandler = () => undefined;
  if (handle !== undefined) app.provide(PANEL_HANDLE_KEY, handle);
  app.mount(host);
  return { host, app };
};

describe('usePanel', () => {
  it('returns the handle the app provides, with reactive props and context', async () => {
    const state = reactive<{ props: number | undefined; courseId: string }>({
      props: 1,
      courseId: 'c1',
    });
    const handle: PanelHandle = {
      panelId: 'acme.panel',
      get props() {
        return state.props;
      },
      context: state,
      call: async (commandId) => commandId,
    };
    let seen: PanelHandle | undefined;
    const { host, app } = mountWith(
      defineComponent({
        setup() {
          seen = usePanel();
          return () =>
            h('p', `${seen?.panelId}:${seen?.props}:${seen?.context.courseId}`);
        },
      }),
      handle,
    );
    expect(seen).toBe(handle);
    expect(host.textContent).toBe('acme.panel:1:c1');
    state.props = 2;
    state.courseId = 'c2';
    await Promise.resolve();
    expect(host.textContent).toBe('acme.panel:2:c2');
    app.unmount();
  });

  it('throws a clear error outside a panel', () => {
    expect(() =>
      mountWith(
        defineComponent({
          setup() {
            usePanel();
            return () => null;
          },
        }),
      ),
    ).toThrow(/panel component/);
  });
});
